import timingMetric from "../metrics/timingMetric";
import {promisify} from 'util';
import redisClient from 'redis';
import config from "config";
import log from '../log';
import metrics, {CACHE} from '../metrics';

const DURATION_1_DAY = 24 * 60 * 60;

function key(params) {
  return Object.entries(params).map(([key, value]) => `${key}=${value}`).join('-');
}

export default function redis() {
  const url = config.get('redis.url');

  const client = redisClient.createClient({url, prefix: 'iaas--'});
  const get = promisify(client.get).bind(client);
  const setex = promisify(client.setex).bind(client);
  const set = promisify(client.set).bind(client);

  async function getFromCache(keyToUse, cacheOperation) {
    const metric = timingMetric(CACHE, {tags: {cacheOperation}});
    const result = await get(keyToUse);
    metrics.write(metric);
    return result;
  }

  async function addToTempCache(keyToUse, data, cacheOperation) {
    const metric = timingMetric(CACHE, {tags: {cacheOperation}});
    try {
      await setex(keyToUse, DURATION_1_DAY, data);
      return true;
    } catch (e) {
      const message = e.toString();
      log('error', `error adding ${keyToUse} to temporary cache: ${message}`);
    } finally {
      metrics.write(metric);
    }
    return false;
  }

  async function addToCache(keyToUse, data, cacheOperation) {
    const metric = timingMetric(CACHE, {tags: {cacheOperation}});
    try {
      await set(keyToUse, data);
      return true;
    } catch (e) {
      const message = e.toString();
      log('error', `error adding ${keyToUse} to cache: ${message}`);
    } finally {
      metrics.write(metric);
    }
    return false;
  }

  async function getImageFromCache(params) {
    return getFromCache(key(params), 'getImageFromCache');
  }

  async function addImageToCache(params, url) {
      return addToTempCache(key(params), url, 'addImageToCache')
  }

  async function getSizeFromCache(params) {
    return getFromCache(key(params), 'getSizeFromCache');
  }

  async function addSizeToCache(params, url) {
    return addToCache(key(params), url, 'addSizeToCache')
  }


  function close() {
    client.quit();
  }

  return {
    close,
    addImageToCache,
    getImageFromCache,
    getSizeFromCache,
    addSizeToCache,
  };
}
