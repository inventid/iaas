import config from 'config';

import log from '../log';
import console from './console';
import influx from './influx';
import timingMetric from './timingMetric';

export const REQUEST = 'request';
export const REDIRECT = 'redirect';
export const GENERATION = 'generation';
export const UPLOAD_TO_CACHE = 'uploadToCache';
export const UPLOAD = 'upload';
export const ORIGINAL = 'original';
export const REQUEST_TOKEN = 'requestToken';

export const VALID_TYPES = [REQUEST, REDIRECT, GENERATION, UPLOAD_TO_CACHE, UPLOAD, ORIGINAL, REQUEST_TOKEN];

export function metricFromParams(params, type = REQUEST) {
  const fields = {
    name: params.name,
    width: params.width,
    height: params.height,
    blur_radius: params.blur && params.blug.radius || 0,
    blur_sigma: params.blur && params.blug.sigma || 0,
    type: params.type,
    mime: params.mime,
    quality: params.quality,
    fit: params.fit
  };
  const tags = {};
  return timingMetric(type, {fields, tags});
}

function setup() {
  const metricImplementations = [];
  if (config.has('metrics.influx')) {
    log('info', 'Setting up influx metrics');
    metricImplementations.push(influx);
  }
  if (config.has('metrics.console')) {
    log('info', 'Setting up console metrics');
    metricImplementations.push(console);
  }
  return {
    write(metric) {
      metricImplementations.forEach(implementation => implementation.write(metric));
    }
  };
}

const instance = setup();
export default instance;
