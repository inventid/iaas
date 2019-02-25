import AWS from "aws-sdk";
import config from "config";
import {futureDate} from "./helper";
import log from "./log";
import metrics from './metrics';
import {metricFromParams, UPLOAD_TO_CACHE} from './metrics';
import database from './databases';

// The AWS config needs to be set before this object is created
AWS.config.update({
  accessKeyId: config.get('aws.access_key'),
  secretAccessKey: config.get('aws.secret_key'),
  region: config.get('aws.region')
});
const S3 = new AWS.S3();

const upload = (client, params) => {
  return new Promise((resolve, reject) => client.putObject(params, err => err ? reject(err) : resolve()));
};


// TODO: Switch to aws.cache_host only soon
const cacheHost = () => {
  if (config.has('aws.cache_host')) {
    return config.get('aws.cache_host');
  } else {
    return config.get('aws.bucket_url');
  }
};

// This method should only be used if you need to push a static file, not a generated image!
export async function pushFile(path, data, mime) {
  const uploadParams = {
    Bucket: config.get('aws.bucket'),
    Key: path,
    ACL: 'public-read',
    Body: data,
    Expires: futureDate(),
    ContentType: mime,
    // We let any intermediate server cache this result as well
    CacheControl: 'public'
  };
  try {
    await upload(S3, uploadParams);
  } catch (e) {
    log('error', `Pushing of static file ${path} failed: ${e}`);
    throw e;
  }
}

export default async (name, params, data) => {
  // See https://github.com/inventid/iaas/issues/78
  const renderedAt = new Date();
  const savedName = `${renderedAt.toISOString()}_${name}`;
  const uploadParams = {
    Bucket: config.get('aws.bucket'),
    Key: savedName,
    ACL: 'public-read',
    Body: data,
    Expires: futureDate(),
    ContentType: params.mime,
    // We let any intermediate server cache this result as well
    CacheControl: 'public'
  };

  const startTime = new Date();
  try {
    const metric = metricFromParams(params, UPLOAD_TO_CACHE);
    await upload(S3, uploadParams);
    metrics.write(metric);
  } catch (e) {
    log('error', `AWS upload error: ${JSON.stringify(e)}`);
    return;
  }
  log('info', `Uploading ${name} to AWS image took ${new Date() - startTime}ms`);

  const url = `${cacheHost()}/${savedName}`;

  try {
    const addedSuccessfully = await database.addToCache(params, url, renderedAt);
    if (addedSuccessfully) {
      log('info', `Image ${name} was added to cache`);
    } else {
      log('warn', 'Image could not be added to cache');
    }
  } catch (e) {
    log('error', e);
  }
};

