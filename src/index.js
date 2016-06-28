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

let db;
const connectionString = `postgres://${config.get('postgresql.user')}:${config.get('postgresql.password')}@${config.get('postgresql.host')}/${config.get('postgresql.database')}`; //eslint-disable-line max-len

process.on('uncaughtException', function (err) {
  console.log(err);
});

const promiseUpload = (form, request) => {
  return new Promise((resolve, reject) => form.parse(request, (err, fields, files) => err ? reject(err) : resolve(files)));
};

const cropParametersOnUpload = (req) => {
  const xOffset = Number(req.query.x) || undefined;
  const yOffset = Number(req.query.y) || undefined;
  const width = Number(req.query.width) || undefined;
  const height = Number(req.query.height) || undefined;
  if (xOffset && yOffset && width && height) {
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

  const canConsumeToken = token(db).consume(sentToken, name);
  if (!canConsumeToken) {
    return res.status(403).json()
  }

  // Valid token
  const form = new formidable.IncomingForm();
  const files = await promiseUpload(form, req);
  if (!files.image || !files.image.path) {
    return res.status(400).end();
  }
  const cropParameters = cropParametersOnUpload(req);
  const result = await imageResponse.upload(name, files.image.path, cropParameters);
  log('info', `Finished writing original file ${name}`);
  return res.json({
    status: 'OK',
    id: name,
    original_height: result.originalHeight,
    original_width: result.originalWidth,
  });
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
    log('info', 'healthcheck OK');
  } else {
    res.status(500).end('No database connection');
    log('error', 'healthcheck FAILED');
  }
});
server.get('/robots.txt', (req, res) => {
  const content = (config.has('allow_indexing') && config.get('allow_indexing')) ?
    "User-agent: *\nAllow: /" : "User-agent: *\nDisallow: /";
  res.status(200).end(content);
  log('info', 'robots.txt served');
});

// The actual endpoints for fetching
server.get('/(:name)_(:width)_(:height)_(:scale)x.(:format)', (req, res) => {
  // Serve a resized image with scaling
  const params = urlParameters(req);
  imageResponse.magic(db, params, req.method, res);
});
server.get('/(:name)_(:width)_(:height).(:format)', (req, res) => {
  // Serve a resized image
  const params = urlParameters(req);
  imageResponse.magic(db, params, req.method, res);
});
server.get('/(:name).(:format)', (req, res) => {
  // Serve the original
  const params = urlParameters(req);
  imageResponse.original(db, params, req.method, res);
});

// The upload stuff
server.post('/token', async(req, res) => {
  // Create a token
  const image = req.body.id;
  if (image === null) {
    return res.status(400).end();
  }
  const tokenBackend = token(db);
  const newToken = await tokenBackend.createToken(image);
  if (!newToken) {
    // Duplicate
    return res.status(403).json({error: 'The requested image_id is already requested'});
  }
  res.json({token: newToken});
});
server.post('/(:name).(:format)', uploadImage);
server.post('/(:name)', uploadImage);


pg.connect(connectionString, (err, client) => {
  if (err) {
    log('error', `error fetching client from pool: ${err}`);
  } else {
    db = client;
    migrateAndStart(db, './migrations', () => {
      const port = process.env.PORT || 1337; //eslint-disable-line no-process-env
      server.listen(port, () => log('info', `Server started listening on port ${port}`));
    });
  }
});
