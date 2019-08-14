import log from "./log";
import cache from "./caches";

export async function getFromCache(params) {
  try {
    if (cache === null) {
      return null;
    }
    return await cache.getFromCache(params);
  } catch (e) {
    log('error', e.toString());
    return null;
  }
}

export async function addToCache(params, url) {
  if (cache === null) {
    return;
  }
  await cache.addToCache(params, url);
}
