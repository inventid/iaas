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

  async function getFromCache(params) {
    const metric = timingMetric(CACHE, {tags: {cacheOperation: 'getFromCache'}});
    const result = await get(key(params));
    metrics.write(metric);
    return result;
  }

  async function addToCache(params, url) {
    const metric = timingMetric(CACHE, {tags: {cacheOperation: 'addToCache'}});
    const keyToUse = key(params);
    try {
      await setex(keyToUse, DURATION_1_DAY, url);
      return true;
    } catch (e) {
      const message = e.toString();
      log('error', `error adding ${url} for ${keyToUse} to cache: ${message}`);
    } finally {
      metrics.write(metric);
    }
    return false;
  }

  function close() {
    client.quit();
  }

  return {
    close,
    addToCache,
    getFromCache
  };
}
