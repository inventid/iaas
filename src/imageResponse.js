require("babel-polyfill");

import config from "config";
import promisify from "promisify-node";
import log from "./log";
import dbCache from "./dbCache";
import image from "./image";
import aws from "./aws";
import {futureDate} from "./helper";

const fs = promisify('fs');

const imagePath = (name) => `${config.get('originals_dir')}/${name}`;

const redirectTimeout = config.has('redirect_cache_timeout') ? config.get('redirect_cache_timeout') : 0;

// Determine whether the image exists on disk
// Returns either true of false
const doesImageExist = async(name) => {
  try {
    await fs.access(imagePath(name), fs.R_OK);
    return true;
  } catch (e) {
    return false;
  }
};

const isRequestedImageWithinBounds = (params) => {
  // Check if we are allowed to serve an image of this size and optionally redirect
  return (params.width <= config.get('constraints.max_width') && params.height <= config.get('constraints.max_height'));
};

const calculateNewBounds = (params) => {
  // Resize the parameters
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
  return response.status(307).set({
    'X-Redirect-Info': 'The requested image size falls outside of the allowed boundaries of this service. We are directing you to the closest available match.', //eslint-disable-line max-len
    'Location': `/${params.name}_${params.width}_${params.height}.${params.type}?fit=${params.fit}&blur=${Boolean(params.blur)}`
  }).end();
};

const redirectToCachedEntity = (cacheUrl, params, response) => {
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

  response.status(307).set(headers).end();
  response.end();
};

const sendFoundHeaders = (params, response) => {
  // Get the image and resize it. We allow any intermediate servers and browsers to use this cached resource as well
  response.status(200).type(params.mime).set({
    'Expires': futureDate(),
    'Cache-Control': 'public'
  });
};

const logErrIfNeeded = (stream, streamName) => {
  let data = '';
  stream.on('data', (chunk) => {
    log('debug', `Got a chunk of data: ${chunk}`);
    data = `${data}${chunk}`;
  });
  stream.on('end', () => {
    if (data !== '') {
      log('error', `Got error data from stream '${streamName}': ${data}`);
    } else {
      log('debug', 'Finished error stream. Nothing was in the stream.');
    }
  });
};

const imageKey = params => `${params.name}_${params.width}x${params.height}.${params.fit}.b-${Boolean(params.blur)}.${params.type}`;

export default {
  magic: async function (db, params, method, response, request) {
    const cache = dbCache(db);
    if (params === null) {
      // Invalid, hence reject
      response.status(400).end();
      return;
    }

    const imageExists = await doesImageExist(params.name);
    if (!imageExists) {
      response.status(404).end();
      return;
    }

    // Image exists
    if (!isRequestedImageWithinBounds(params)) {
      redirectImageToWithinBounds(calculateNewBounds(params), response);
      return;
    }

    // Image exists and is within bounds.
    // This method is mainly used by browsers to serve retina images
    if (isHeadRequest(method)) {
      response.status(200).end();
      log('info', `HEAD request for ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)}) can be served`);  //eslint-disable-line max-len
      return;
    }
    log('debug', `Request for ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)})`);  //eslint-disable-line max-len

    const cacheValue = await cache.getFromCache(params);
    if (cacheValue) {
      log('info', `Cache hit for ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)})`);  //eslint-disable-line max-len
      redirectToCachedEntity(cacheValue, params, response);
      return;
    }

    // Image is present but not in the correct setting
    log('info', `Cache miss for ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)})`);  //eslint-disable-line max-len
    sendFoundHeaders(params, response);

    const clientStartTime = new Date();
    const browserImage = await image.magic(imagePath(params.name), params, response);
    browserImage.stream(params.type, (err, stdout, stderr) => {
      logErrIfNeeded(stderr, 'Live image creation stderr');
      if (err) {
        response.status(500).end();
        log('error', `Error occurred while creating live image: ${err}`);
        return;
      }
      const errors = [];
      const r = stdout.pipe(response);
      r.on('finish', () => {
        if (errors.length === 0) {
          log('info', `Creating live image took ${new Date() - clientStartTime}ms: ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)})`);  //eslint-disable-line max-len
        } else {
          log('warn', `Got an error while creating live image. Took ${new Date() - clientStartTime}ms: ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)}). Errors: ${JSON.stringify(errors)}`);  //eslint-disable-line max-len
        }
        response.end();
      });
      r.on('error', (error) => {
        log('error', `The live image stream hit an error: ${error}`);
        stdout.unpipe(response);
        errors.push(error);
        response.end();
        r.end();
      });
      if (request) {
        request.once('close', () => {
          log('warn', 'Client disconnected prematurely. Terminating stream');
          stdout.unpipe(response);
          errors.push('Client disconnected prematurely.');
          response.end();
          r.end();
        });
      }

    });

    const awsStartTime = new Date();
    const awsImage = await image.magic(imagePath(params.name), params, response);
    awsImage.toBuffer(params.type, (err, stream) => {
      if (!err) {
        log('info', `Creating AWS image took ${new Date() - awsStartTime}ms: ${params.name}.${params.type} (${params.width}x${params.height}px, fit: ${params.fit}, blur: ${Boolean(params.blur)})`);  //eslint-disable-line max-len
        aws(cache)(imageKey(params), params, stream);
      }
    });
  },
  original: async function (db, params, method, response) {
    const startTime = new Date();
    const imageExists = await doesImageExist(params.name);
    if (!imageExists) {
      response.status(404).end();
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
    log('info', `Serving original image ${params.name} took ${new Date() - startTime}ms`);  //eslint-disable-line max-len
  },
  upload: async function (name, path, cropParameters) {
    const destinationPath = `${config.get('originals_dir')}/${name}`;
    return await image.writeOriented(path, destinationPath, cropParameters);
  }
};
