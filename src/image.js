import { MAX_IMAGE_ON_DISK} from "./sizes";

require("babel-polyfill");

import fs from "fs";
import gm from "gm";
import config from "config";
import log from "./log";
import uuid from "uuid/v4";
import * as fastCache from './fastCache';

const gmOptions = {};
if (config.has('timeout.conversion')) {
  const timeout = Number(config.get('timeout.conversion'));
  if (isNaN(timeout)) {
    log('warn', 'The configuration value of timeout.conversion resolved to a NaN value. Ignoring it!');
  } else if (timeout < 0) {
    log('warn', 'The configuration value of timeout.conversion did not resolve to a nonnegative value. Ignoring it!');
  } else if (timeout === 0) {
    log('info', 'Not setting any image timeout');
  } else {
    gmOptions.timeout = timeout;
  }
}

const options = Object.assign({}, {imageMagick: true}, gmOptions);
log('info', `Booting gm with the following options: ${JSON.stringify(options)}`);

const im = gm.subClass(options);

// 10 seconds
const CLEAR_TEMP_FILES_TIMEOUT = 10000;

// Wrap these calls in promises so we can use async/await
const write = (client, file) => {
  return new Promise((resolve, reject) => client.write(file, err => err ? reject(err) : resolve()));
};
const size = async (client) => {
  return await new Promise((resolve, reject) => client.size({bufferStream: true}, (err, data) => err ? reject(err) : resolve(data)));
};

// Strip the image of any profiles or comments
const strip = async (client) => {
  return client.strip();
};

// Interlacing for png isn't efficient (both in filesize as render performance), so we only do it for jpg
const interlace = async (client, params) => {
  if (params.mime === 'image/jpeg') {
    return client.interlace('Line');
  }
  return client;
};

// When cropping, we size the image first to fix completely within the bounding box
// Then we crop the requested size, and center to the center of the image
const crop = async (client, params) => {
  // Resize the image to fit within the bounding box
  // The ^ ensures the images is resized while maintaining the ratio
  // However the sizes are treated as minimum values instead of maximum values
  client = client.resize(params.width, params.height, '^');
  const tmpFile = `/tmp/${uuid()}`;
  try {
    await write(client, tmpFile);
    client = im(tmpFile).options(gmOptions);
    const imgSize = await size(client);
    setTimeout(() => fs.unlink(tmpFile, err => {
      if (err) {
        log('error', `Tempfile ${tmpFile} could not be deleted`);
      }
    }), CLEAR_TEMP_FILES_TIMEOUT);
    return client
      .repage(imgSize.width, imgSize.height, 0, 0)
      .gravity('Center')
      // Crop the image to the exact size (the ! indicates a force)
      // This is ok since we first resized appropriately
      .crop(params.width, params.height, '!');
  } catch (e) {
    log('error', 'could not write tempfile');
    log('error', e.stack);
    throw e;
  }
};

// The sizes in the params given define the bounding box. The image is sized
// proportionally such that it fits in the bounding box without cropping
const clip = async (client, params) => {
  return client.resize(params.width, params.height);
};

const cover = async (client, params) => {
  return client.resize(params.width, params.height, '^');
};

// Same as clipping, however the remainder of the bounding box is filled with
// white.
const canvas = async (client, params) => {
  client = await clip(client, params);
  return client.gravity('Center').extent(params.width, params.height);
};

// Fill a transparent background with white
const background = async (client, params) => {
  if (params.mime === 'image/jpeg') {
    return client.background('white').flatten();
  }
  return client;
};

// Fit the image appropriately.
const fit = async (client, params) => {
  //For original format
  if (!params.width || !params.height) {
    return client;
  }
  if (params.fit === 'crop') {
    return crop(client, params);
  } else if (params.fit === 'canvas') {
    return canvas(client, params);
  } else if (params.fit === 'clip') {
    return clip(client, params);
  } else if (params.fit === 'cover') {
    return cover(client, params);
  }
  throw new Error(`Format '${params.fit}' was accepted but could not be handled`);
};

const setQuality = async (client, params) => {
  if (params.quality === -1) {
    return client;
  }

  // The imagemagick 'quality' parameter has a very different meaning for
  // different image types, so it's not a good idea to just blindly pass it
  // through. For now, we only support jpg and webp compression, which is the most intuitive.
  switch (params.mime) {
    case 'image/jpeg':
    case 'image/webp':
      return client.quality(Math.min(100, Math.max(0, params.quality)));
    default:
      //No compression supported for other types
      return client;
  }
};

// Blur the image if requested in the params
const blur = async (client, params) => {
  if (params.blur === null) {
    return client;
  }
  return client.blur(params.blur.radius, params.blur.sigma);
};

export async function magic(file, params) {
  // We add the [0] so we always read the first frame. As such we do not support any animation (as intended)
  let client = im(`${file}[0]`).options(gmOptions);
  client = await strip(client);
  client = await fit(client, params);
  client = await background(client, params);
  client = await blur(client, params);
  client = await setQuality(client, params);
  client = await interlace(client, params);
  return client;
}

export async function imageSize(path) {
  // Check whether we have this thing in cache first
  const cacheResult = await fastCache.getSizeFromCache(path);
  if (cacheResult) {
    return cacheResult;
  }
  const result = await size(im(path).options(gmOptions));
  // Dont wait for adding it to the cache
  fastCache.addSizeToCache(path, result);
  return result;
}

export async function writeOriented(source, destination, cropParameters) {
  // if possible, crop first (since the UA had that orientation), then orient
  if (cropParameters) {
    const cropped = im(source).options(gmOptions)
      .crop(cropParameters.width, cropParameters.height, cropParameters.xOffset, cropParameters.yOffset);
    try {
      await write(cropped, source);
    } catch (e) {
      log('error', e.stack);
      throw e;
    }
  }

  const maxSizeAlongAxis = Math.floor(Math.sqrt(MAX_IMAGE_ON_DISK * 1e6));
  const oriented = im(source).options(gmOptions)
    .autoOrient()
    // We also reduce the saved size a bit, so the size on disk is a lot smaller, which is essential for future conversions
    // We'll only downscale, and maintain aspect ratios
    .resize(maxSizeAlongAxis, maxSizeAlongAxis, ">");

  try {
    await write(oriented, destination);
  } catch (e) {
    log('error', e.stack);
    throw e;
  }

  try {
    // Set this into the cache early
    const imgSize = await imageSize(destination);
    return {
      originalHeight: imgSize.height || null,
      originalWidth: imgSize.width || null
    };
  } catch (e) {
    log('error', e.stack);
    return {
      originalHeight: null,
      originalWidth: null
    };
  }
}

export async function imageArea(path) {
  try {
    const imgSize = await imageSize(path);
    return imgSize.width * imgSize.height;
  } catch (e) {
    log('error', e);
    return Number.MAX_SAFE_INTEGER;
  }
}
