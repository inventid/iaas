import {proxy} from "./proxy";

require("babel-polyfill");

import config from "config";
import promisify from "promisify-node";
import log from "./log";
import * as dbCache from "./dbCache";
import * as fastCache from "./fastCache";
import * as image from "./image";
import aws from "./aws";
import {futureDate} from "./helper";
import metrics, {GENERATION, ORIGINAL, REDIRECT} from './metrics';

const fs = promisify('fs');

const imagePath = (name) => `${config.get('originals_dir')}/${name}`;

const redirectTimeout = config.has('redirect_cache_timeout') ? config.get('redirect_cache_timeout') : 0;

const didTimeout = (error) => {
  return error.message === 'gm() resulted in a timeout.';
};

// Determine whether the image exists on disk
// Returns either true of false
const doesImageExist = async (name) => {
  try {
    await fs.access(imagePath(name), fs.R_OK);
    return true;
  } catch (e) {
    return false;
  }
};

// GM does not always return a nice buffer
// https://github.com/aheckmann/gm/issues/572#issuecomment-293768810
const gmToBuffer = (data) => {
  return new Promise((resolve, reject) => {
    data.stream((err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      const chunks = [];
      stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });
      // these are 'once' because they can and do fire multiple times for multiple errors,
      // but this is a promise so you'll have to deal with them one at a time
      stdout.once('end', () => {
        resolve(Buffer.concat(chunks));
      });
      stderr.once('data', (data) => {
        reject(String(data));
      });
    });
  });
};

const isRequestedImageWithinBounds = (params) => {
  // Check if we are allowed to serve an image of this size and optionally redirect
  return (params.width && params.height) &&
    (params.width <= config.get('constraints.max_width') && params.height <= config.get('constraints.max_height'));
};

const calculateNewBounds = async (params) => {
  // Resize the parameters
  // If no params are set then we load them from the actual image before calculating new bounds
  if (!params.width || !params.height) {
    const fileSize = await image.imageSize(imagePath(params.name));
    params.width = fileSize.width;
    params.height = fileSize.height;
  }
  const providedRatio = params.width / params.height;
  if (params.width > config.get('constraints.max_width')) {
    params.width = config.get('constraints.max_width');
    if (params.fit === 'crop') {
      params.height = params.width / providedRatio;
    }
  }
  if (params.height > config.get('constraints.max_height')) {
    params.height = config.get('constraints.max_height');
    if (params.fit === 'crop') {
      params.width = params.height * providedRatio;
    }
  }
  return params;
};

const isHeadRequest = method => (method === 'HEAD');

const redirectImageToWithinBounds = (params, response) => {
  const newLocation = `/${params.name}_${params.width}_${params.height}.${params.type}` +
    `?fit=${params.fit}&blur=${Boolean(params.blur)}&quality=${params.quality}`;
  return response.status(303).set({
    'X-Redirect-Info': 'The requested image size falls outside of the allowed boundaries of this service. We are directing you to the closest available match.', //eslint-disable-line max-len
    'Location': newLocation
  }).end();
};

const redirectToCachedEntity = (cacheUrl, params, response) => {
  if (params.proxy) {
    proxy(cacheUrl, response);
    return;
  }
  // We redirect the user to the new location. We issue a temporary redirect such that the
  // request url stays the representitive url, and because temporary redirects generally
  // give less issues than permanent redirects for the odd chance that the underlying resource
  // does actually change
  const headers = {
    'Location': cacheUrl
  };
  if (redirectTimeout) {
    headers['Cache-Control'] = `max-age=${redirectTimeout}`;
  }

  response.status(303).set(headers).end();
  response.end();
};

const sendFoundHeaders = (params, response) => {
  // Get the image and resize it. We allow any intermediate servers and browsers to use this cached resource as well
  response.status(200).type(params.mime).set({
    'Expires': futureDate(),
    'Cache-Control': 'public'
  });
};

const imageKey = params =>
  `${params.name}_${params.width}x${params.height}.${params.fit}` +
  `.b-${Boolean(params.blur)}.q-${params.quality}.${params.type}`;


export async function magic(params, method, response, stats = undefined, metric = undefined, shouldBeFresh = false) {
  if (params === null) {
    // Invalid, hence reject
    response.status(400).end();
    if (metric) {
      metric.addTag('status', 400);
      metrics.write(metric);
    }
    return;
  }

  const imageExists = await doesImageExist(params.name);
  if (!imageExists) {
    response.status(404).end();
    if (metric) {
      metric.addTag('status', 404);
      metrics.write(metric);
    }
    return;
  }

  // Image exists
  if (!isRequestedImageWithinBounds(params)) {
    redirectImageToWithinBounds(await calculateNewBounds(params), response);
    if (metric) {
      metric.addTag('status', 307);
      metric.addTag('withinBounds', false);
      metrics.write(metric);
    }
    return;
  }

  const imageDescription = this.description(params);
  // Image exists and is within bounds.
  // This method is mainly used by browsers to serve retina images
  if (isHeadRequest(method)) {
    response.status(200).end();
    log('debug', `HEAD request for ${imageDescription} can be served`);
    // No metrics here
    return;
  }
  log('debug', `Request for ${imageDescription}`);

  const fastCacheValue = await fastCache.getImageFromCache(params);
  if (!shouldBeFresh) {
    if (fastCacheValue) {
      log('debug', `Fast cache hit for ${imageDescription}`);
      redirectToCachedEntity(fastCacheValue, params, response);
      if (metric) {
        metric.addTag('cacheHit', true);
        metric.addTag('withinBounds', true);
        metric.addTag('status', params.proxy ? 303 : 200);
        metric.addTag('proxy', params.proxy);
        metric.stop();
        metrics.write(metric);
        metrics.write(metric.copy(REDIRECT));
      }
      return;
    }

    metric.addTag('cacheHit', false);
    const cacheValue = await dbCache.getFromCache(params);
    if (cacheValue) {
      log('debug', `Cache hit for ${imageDescription}`);
      if (stats) {
        stats.hits.incrementAndGet();
      }
      redirectToCachedEntity(cacheValue, params, response);
      if (metric) {
        metric.addFields(dbCache.stats());
        metric.addTag('withinBounds', true);
        metric.addTag('status', params.proxy ? 303 : 200);
        metric.addTag('proxy', params.proxy);
        metric.stop();
        metrics.write(metric);
        metrics.write(metric.copy(REDIRECT));
      }
      await fastCache.addImageToCache(params, cacheValue);
      return;
    }
    if (stats) {
      stats.misses.incrementAndGet();
    }
  }

  // Image is present but not in the correct setting
  log('debug', `Cache miss for ${imageDescription}`);
  sendFoundHeaders(params, response);

  const clientStartTime = new Date();
  try {
    const browserImage = await image.magic(imagePath(params.name), params);
    const browserBuffer = await gmToBuffer(browserImage);
    log('info', `Creating image took ${new Date() - clientStartTime}ms: ${imageDescription}`);

    const awsBuffer = Buffer.from(browserBuffer);
    response.end(browserBuffer);
    if (metric) {
      metric.addFields(dbCache.stats());
      metric.addTag('status', 200);
      metric.addTag('withinBounds', true);
      metric.stop();
      metrics.write(metric);
      metrics.write(metric.copy(GENERATION));
    }
    if (!shouldBeFresh) {
      await aws(imageKey(params), params, awsBuffer);
    }
  } catch (err) {
    const status = didTimeout(err) ? 504 : 500;
    response.status(status).end();
    if (metric) {
      metric.addTag('status', status);
      metric.stop();
      metrics.write(metric);
      metrics.write(metric.copy(GENERATION));
    }
    log('error', `Error occurred while creating live image ${imageDescription}: ${err}`);
  }
}

export async function original(params, method, response, metric = undefined) {
  const startTime = new Date();
  const imageExists = await doesImageExist(params.name);
  if (!imageExists) {
    response.status(404).end();
    if (metric) {
      metric.addTag('status', 404);
      metrics.write(metric);
    }
    return;
  }
  response.status(200).set({
    'Content-Type': params.mime,
    'Cache-Control': 'public',
    Etag: `${params.name}_${params.type}`,
    Expires: futureDate()
  });
  const data = await fs.readFile(imagePath(params.name));
  response.end(data);
  if (metric) {
    metric.addTag('status', 200);
    metric.stop();
    metrics.write(metric);
    metrics.write(metric.copy(ORIGINAL));
  }
  log('info', `Serving original image ${params.name} took ${new Date() - startTime}ms`);
}

export async function upload(name, path, cropParameters) {
  const destinationPath = `${config.get('originals_dir')}/${name}`;
  return await image.writeOriented(path, destinationPath, cropParameters);
}

export function description(params) {
  return `${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)}), quality: ${Number(params.quality) || 'auto'}`; //eslint-disable-line max-len
}

export async function hasAllowableImageSize(path, maxSizeInMegapixel) {
  const imageSize = await image.imageArea(path);
  return imageSize < (maxSizeInMegapixel * 1e6);
}
