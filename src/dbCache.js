import "babel-polyfill";

import log from "./log";
import database from "./databases";

export default {
    async getFromCache(params) {
      try {
        return await database.getFromCache(params);
      } catch (e) {
        log('error', e.toString());
        return null;
      }
    },
    async addToCache(params, url, renderedAt) {
      return await database.addToCache(params, url, renderedAt);
    }
};
