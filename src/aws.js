import AWS from "aws-sdk";
import config from "config";
import {futureDate} from "./helper";
import log from "./log";

// The AWS config needs to be set before this object is created
AWS.config.update({
  accessKeyId: config.get('aws.access_key'),
  secretAccessKey: config.get('aws.secret_key'),
  region: config.get('aws.region')
});
const S3 = new AWS.S3();

const uploadPromise = (client, params) => {
  return new Promise((resolve, reject) => client.putObject(params, err => err ? reject(err) : resolve()));
};

export default (cache) => async(name, params, data) => {
  const uploadParams = {
    Bucket: config.get('aws.bucket'),
    Key: name,
    ACL: 'public-read',
    Body: data,
    Expires: futureDate(),
    ContentType: params.mime,
    // We let any intermediate server cache this result as well
    CacheControl: 'public'
  };
  try {
    await uploadPromise(S3, uploadParams);
  } catch (e) {
    log('error', `AWS upload error: ${JSON.stringify(e)}`);
    return;
  }

  log('info', `Uploading of ${name} went very well`);
  const url = `${config.get('aws.bucket_url')}/${name}`;

  try {
    await cache.addToCache(params, url);
    log('info', 'Image was added to cache');
  } catch (e) {
    log('error', e);
  }
}
