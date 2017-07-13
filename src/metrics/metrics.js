import config from 'config';

import log from '../log';
import console from './console';
import influx from './influx';
import timingMetric from './timingMetric';

export const VALID_TYPES = ['request', 'redirect', 'generation', 'uploadToCache', 'upload', 'original'];

export function metricFromParams(params, type = VALID_TYPES[0]) {
  const fields = {
    name: params.name,
    width: params.width,
    height: params.height,
    blur: params.blur,
    type: params.type,
    mime: params.mime,
    quality: params.quality,
    fit: params.fit
  };
  const tags = {};
  return timingMetric(type, {fields, tags});
}

export default function setup() {
  const metricImplementations = [];
  if (config.has('metrics.influx')) {
    log('info', 'Setting up influx metrics');
    metricImplementations.push(influx());
  }
  if (config.has('metrics.console')) {
    log('info', 'Setting up console metrics');
    metricImplementations.push(console());
  }
  return {
    write(metric) {
      metricImplementations.forEach(implementation => implementation.write(metric));
    }
  };
}
