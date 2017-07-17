import uuid from "uuid/v4";
import log from "./log";

import database from './databases';

const shouldRunCleanup = () => Math.floor(Math.random() * 10) === 0;

export default {
  createToken: async (id) => {
    const newToken = uuid();
    try {
      await database.createToken(id, newToken);
      log('info', 'Created token successfully');
      if (shouldRunCleanup()) {
        await database.cleanupTokens()();
      }
      return newToken;
    } catch (e) {
      // Duplicate for the id
      log('error', e.stack);
      return null;
    }
  },
  consumeToken: async (token, id) => await database.consumeToken(token, id)
};
