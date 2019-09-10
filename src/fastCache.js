import log from "./log";
import cache from "./caches";

export async function getImageFromCache(params) {
  try {
    if (cache === null) {
      return null;
    }
    return await cache.getImageFromCache(params);
  } catch (e) {
    log('error', e.toString());
    return null;
  }
}

export async function addImageToCache(params, url) {
  if (cache === null) {
    return;
  }
  await cache.addImageToCache(params, url);
}

export async function getSizeFromCache(params) {
  try {
    if (cache === null) {
      return null;
    }
    return await cache.getSizeFromCache(params);
  } catch (e) {
    log('error', e.toString());
    return null;
  }
}

export async function addSizeToCache(params, url) {
  if (cache === null) {
    return;
  }
  await cache.addSizeToCache(params, url);
}
