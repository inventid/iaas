import "babel-polyfill";

import express from "express";
import config from "config";
import bodyParser from "body-parser";
import formidable from "formidable";
import log from "./log";
import urlParameters, {hasFiltersApplied} from "./urlParameters";
import * as imageResponse from "./imageResponse";
import * as token from "./token";
import {areAllDefined, roundedRatio} from "./helper";
import IntegerCounter from "./integerCounter";
import metrics, {metricFromParams, REQUEST_TOKEN, UPLOAD} from "./metrics";
import timingMetric from "./metrics/timingMetric";
import database from './databases';
import robotsTxt, {syncRobotsTxt} from "./robotsTxt";
import startMigrations from './migrations';

const MAX_IMAGE_IN_MP = (config.has('constraints.max_input') && config.get('constraints.max_input')) || 30;

process.on('uncaughtException', function (err) {
  log('error', err);
  process.exit(1);
});

const hitCounter = IntegerCounter();
const missCounter = IntegerCounter();
const uploadCounter = IntegerCounter();

const startedAt = new Date();

const stats = {
  hits: hitCounter,
  misses: missCounter,
  uploads: uploadCounter,
  get: () => {
    const hits = hitCounter.get();
    const misses = missCounter.get();
    const uploads = uploadCounter.get();
    const total = (hits + misses);
    const datetime = new Date().toISOString();
    const uptimeInSeconds = (new Date() - startedAt) / 1000;
    const generationsPerMinute = roundedRatio(misses, uptimeInSeconds / 60);
    return {
      datetime,
      hits,
      misses,
      uploads,
      uptimeInSeconds,
      generationsPerMinute,
      cacheHitRatio: roundedRatio(hits, total)
    };
  }
};
let statsPrinter;

const promiseUpload = (form, request) => {
  return new Promise((resolve, reject) => form.parse(request, (err, fields, files) => err ? reject(err) : resolve(files)));
};

const getValidDimensionParameter = (value) => {
  // Convert to a number and drop the decimals
  const number = ~~Number(value);
  if (isNaN(number) || number < 0) {
    return undefined;
  }
  return number;
};

const cropParametersOnUpload = (req) => {
  const xOffset = getValidDimensionParameter(req.query.x);
  const yOffset = getValidDimensionParameter(req.query.y);
  const width = getValidDimensionParameter(req.query.width);
  const height = getValidDimensionParameter(req.query.height);
  if (areAllDefined([xOffset, yOffset, width, height])) {
    return {
      xOffset, yOffset, width, height
    };
  }
  return null;
};

const uploadImage = async (req, res) => {
  const sentToken = req.headers['x-token'];
  const name = req.params.name;
  log('info', `Requested image upload for image_id ${name} with token ${sentToken}`);
  const metric = timingMetric(UPLOAD, {fields: {name: name}});

  const canConsumeToken = await token.consumeToken(sentToken, name);
  if (!canConsumeToken) {
    res.status(403).end();
    metric.addTag('status', 403);
    metrics.write(metric);
    return;
  }

  let uploadCompleted = false;
  let uploadCancelled = false;
  // When an uploads gets cancelled in the progress, we want to make the token available again
  const handleCancelledUpload = async () => {
    if (!uploadCompleted && !uploadCancelled) {
      log('info', `Freeing token for ${name} as the upload was aborted prior to completion`);
      await token.deleteTokenForImageId(name);
      uploadCancelled = true;
    }
  };

  try {
    req.once('close', handleCancelledUpload);

    // Valid token
    const form = new formidable.IncomingForm();
    const files = await promiseUpload(form, req);
    if (!files.image || !files.image.path) {
      res.status(400).end();
      metric.addTag('status', 400);
      metrics.write(metric);
      return;
    }

    const isAllowedToHandle = await imageResponse.hasAllowableImageSize(files.image.path, MAX_IMAGE_IN_MP);
    if (!isAllowedToHandle) {
      log('warn', `Image ${name} was too big to handle (max ${MAX_IMAGE_IN_MP} megapixel allowed) and hence rejected`);
      res.status(413).end();
      metric.addTag('status', 413);
      metrics.write(metric);
      await token.deleteTokenForImageId(name);
      return;
    }

    const cropParameters = cropParametersOnUpload(req);
    if (uploadCancelled) {
      // If the image is cancelled at this point, save ourselves the trouble of doing any image work
      return;
    }

    const result = await imageResponse.upload(name, files.image.path, cropParameters);
    if (uploadCancelled) {
      // At this point the image would already be on disk. However as the client cannot get the final OK, we discard
      // saving it to the database, and instead let the client retry. Also there is a tiny race condition otherwise.
      // While the await for the upload is holding the cancel can occur. In that case the upload has not been marked as
      // ok (yet), so the token is freed, whereas the file is persisted to disk already.
      return;
    }

    stats.uploads.incrementAndGet();
    log('info', `Finished writing original file ${name}`);
    await token.markAsCompleted(sentToken, name);
    // From this point on we no longer clear the token as the upload was successful
    uploadCompleted = true;
    res.json({
      status: 'OK',
      id: name,
      original_height: result.originalHeight,
      original_width: result.originalWidth
    });
    metric.addTag('status', 200);
    metrics.write(metric);
  } catch (e) {
    await handleCancelledUpload();
  }
};

const onClosedConnection = (description) => log('warn', `Client disconnected prematurely. Terminating stream for ${description}`); //eslint-disable-line max-len

const server = express();
server.use(bodyParser.json());
server.use((req, res, next) => {
  // Allow cross origin
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'accept, content-type',
    'Access-Control-Allow-Method': 'GET'
  });
  next();
});
server.get('/_health', async (req, res) => {
  const dbIsOk = await database.isDbAlive();
  if (dbIsOk) {
    res.status(200).end('OK');
    log('debug', 'Healthcheck OK');
  } else {
    res.status(500).end('No database connection');
    log('error', 'Healthcheck FAILED');
  }
});
server.get('/robots.txt', (req, res) => {
  res.status(200).end(robotsTxt());
  log('debug', 'Robots.txt served');
});

function patchConnectionForTermination(req, params) {
  req.once('close', () => onClosedConnection(imageResponse.description(params)));
}

function serveResizedImage(req, res) {
  const params = urlParameters(req);
  patchConnectionForTermination(req, params);
  imageResponse.magic(params, req.method, res, stats, metricFromParams(params));
}

// The actual endpoints for fetching
// Serve a resized image with scaling
server.get('/(:name)_(:width)_(:height)_(:scale)x.(:format)', serveResizedImage);
// Serve a resized image
server.get('/(:name)_(:width)_(:height).(:format)', serveResizedImage);
server.get('/(:name).(:format)', (req, res) => {
  // Serve the original, with optionally filters applied
  const params = urlParameters(req, false);
  patchConnectionForTermination(req, params);
  if (hasFiltersApplied(params)) {
    imageResponse.magic(params, req.method, res, stats, metricFromParams(params));
  } else {
    imageResponse.original(params, req.method, res, metricFromParams(params));
  }
});

// The upload stuff
server.post('/token', async (req, res) => {
  // Create a token
  const image = req.body.id;
  const metric = timingMetric(REQUEST_TOKEN, {fields: {name: image}});
  if (image === null) {
    res.status(400).end();
    metric.addTag('status', 400);
    metrics.write(metric);
    return;
  }
  const newToken = await token.createToken(image);
  if (!newToken) {
    // Duplicate
    res.status(403).json({error: 'The requested image_id is already requested'});
    metric.addTag('status', 403);
    metrics.write(metric);
    return;
  }
  res.json({token: newToken});
  metric.addTag('status', 200);
  metrics.write(metric);
});
server.post('/(:name).(:format)', uploadImage);
server.post('/(:name)', uploadImage);

const slowShutdown = (expressInstance, timeout = 100) => setTimeout(() => {
  if (expressInstance) {
    expressInstance.close();
  }
  if (statsPrinter) {
    clearInterval(statsPrinter);
  }

  // We try to give the database pool back if that is possible. If it does not succeed within 5 seconds we just quit
  // Most likely the database crashed in that case anyway
  const onDone = () => process.exit(2);
  setTimeout(onDone, 5000);
  database.close().then(onDone);
}, timeout);

database.migrate((err) => {
  if (err) {
    log('error', `Error fetching client from pool for migrations: ${err}`);
    slowShutdown(null, 250);
    return;
  }
  const port = process.env.PORT || 1337; //eslint-disable-line no-process-env
  const handler = server.listen(port, () => log('info', `Server started listening on port ${port}`));
  // Sync robots.txt
  syncRobotsTxt();
  // Run any required migrations
  startMigrations();

  // Log the stats every 5 minutes if enabled
  statsPrinter = setInterval(() => log('stats', stats.get()), 5 * 60 * 1000);
  const timeoutDelay = Math.floor(Math.random() * 2500);
  // Delay the checking a bit randomly, as otherwise everyone hugs the connections at the same time
  setTimeout(() => {
    const dbChecker = setInterval(async () => {
      const isAlive = await database.isDbAlive();

      if (!isAlive) {
        clearInterval(dbChecker);
        log('error', 'Database connection went offline! Restarting the application so we can connect to another one');
        // Slight timeout to handle some final requests?
        slowShutdown(handler);
      }
    }, 2500);
  }, timeoutDelay);
});
