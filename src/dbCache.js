import log from "./log";
import database from "./databases";

export async function getFromCache(params) {
  try {
    return await database.getFromCache(params);
  } catch (e) {
    log('error', e.toString());
    return null;
  }
}

export async function addToCache(params, url, renderedAt) {
  return await database.addToCache(params, url, renderedAt);
}

export function stats() {
  return database.stats();
}
