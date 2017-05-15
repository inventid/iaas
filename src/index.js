import express from "express";
import config from "config";
import bodyParser from "body-parser";
import migrateAndStart from "pg-migration";
import pg from "pg";
import formidable from "formidable";
import log from "./log";
import urlParameters from "./urlParameters";
import imageResponse from "./imageResponse";
import token from "./token";
import {areAllDefined} from "./helper";

let db;
const connectionString = `postgres://${config.get('postgresql.user')}:${config.get('postgresql.password')}@${config.get('postgresql.host')}/${config.get('postgresql.database')}`; //eslint-disable-line max-len

const MAX_IMAGE_IN_MP = 30;

process.on('uncaughtException', function (err) {
  log('error', err);
  process.exit(1);
});

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

const uploadImage = async(req, res) => {
  const sentToken = req.headers['x-token'];
  const name = req.params.name;
  log('info', `Requested image upload for image_id ${name} with token ${sentToken}`);

  const canConsumeToken = await token(db).consume(sentToken, name);
  if (!canConsumeToken) {
    res.status(403).end();
    return;
  }

  // Valid token
  const form = new formidable.IncomingForm();
  const files = await promiseUpload(form, req);
  if (!files.image || !files.image.path) {
    res.status(400).end();
    return;
  }

  const isAllowedToHandle = await imageResponse.hasAllowableImageSize(files.image.path, MAX_IMAGE_IN_MP);
  if (!isAllowedToHandle) {
    log('warn', `Image ${name} was too big to handle (over ${MAX_IMAGE_IN_MP} Megapixel) and hence rejected`);
    res.status(413).end();
    return;
  }

  const cropParameters = cropParametersOnUpload(req);
  const result = await imageResponse.upload(name, files.image.path, cropParameters);
  log('info', `Finished writing original file ${name}`);
  res.json({
    status: 'OK',
    id: name,
    original_height: result.originalHeight,
    original_width: result.originalWidth
  });
};

const onClosedConnection = (description) => log('warn', `Client disconnected prematurely. Terminating stream for ${description}`); //eslint-disable-line max-len

const isDbConnectionAlive = async (db) => {
	const promiseQuery = (query, vars) => {
		return new Promise((resolve, reject) => db.query(query, vars, (err, data) => err ? reject(err) : resolve(data)));
	};
	const testQuery = 'SELECT 1';
	try {
		const result = await promiseQuery(testQuery, []);
		return Boolean(result.rowCount && result.rowCount === 1);
	} catch (e) {
		return false;
	}
};

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
server.get('/_health', (req, res) => {
  if (db) {
    res.status(200).end('OK');
    log('debug', 'Healthcheck OK');
  } else {
    res.status(500).end('No database connection');
    log('error', 'Healthcheck FAILED');
  }
});
server.get('/robots.txt', (req, res) => {
  const content = (config.has('allow_indexing') && config.get('allow_indexing')) ?
    "User-agent: *\nAllow: /" : "User-agent: *\nDisallow: /";
  res.status(200).end(content);
  log('debug', 'Robots.txt served');
});

// The actual endpoints for fetching
server.get('/(:name)_(:width)_(:height)_(:scale)x.(:format)', (req, res) => {
  // Serve a resized image with scaling
  const params = urlParameters(req);
  req.once('close', () => onClosedConnection(imageResponse.description(params)));
  imageResponse.magic(db, params, req.method, res);
});
server.get('/(:name)_(:width)_(:height).(:format)', (req, res) => {
  // Serve a resized image
  const params = urlParameters(req);
  req.once('close', () => onClosedConnection(imageResponse.description(params)));
  imageResponse.magic(db, params, req.method, res);
});
server.get('/(:name).(:format)', (req, res) => {
  // Serve the original
  const params = urlParameters(req, false);
  req.once('close', () => onClosedConnection(imageResponse.description(params)));
  imageResponse.original(db, params, req.method, res);
});

// The upload stuff
server.post('/token', async(req, res) => {
  // Create a token
  const image = req.body.id;
  if (image === null) {
    res.status(400).end();
    return;
  }
  const tokenBackend = token(db);
  const newToken = await tokenBackend.createToken(image);
  if (!newToken) {
    // Duplicate
    res.status(403).json({error: 'The requested image_id is already requested'});
    return;
  }
  res.json({token: newToken});
});
server.post('/(:name).(:format)', uploadImage);
server.post('/(:name)', uploadImage);

const slowShutdown = (dbEnder, expressInstance, timeout = 100) => setTimeout(() => {
	if(dbEnder) {
		dbEnder();
	}
	if(expressInstance) {
		expressInstance.close();
	}
	process.exit(2);
}, timeout);

pg.connect(connectionString, (err, client, done) => {
  if (err) {
    log('error', `Error fetching client from pool: ${err}`);
    slowShutdown(done, null, 250);
  } else {
    db = client;
    migrateAndStart(db, './migrations', () => {
      const port = process.env.PORT || 1337; //eslint-disable-line no-process-env
      const handler = server.listen(port, () => log('info', `Server started listening on port ${port}`));
      const dbChecker = setInterval(() => {
        isDbConnectionAlive(db).then(isAlive => {
         if (!isAlive) {
           clearInterval(dbChecker);
           log('error', 'Database connection went offline! Restarting the application so we can connect to another one');
           db = null;
           // Slight timeout to handle some final requests?
           slowShutdown(done, handler);
         }
        });
      }, 500)
    });
  }
});
