import uuid from "uuid/v4";
import log from "./log";

const insertToken = `INSERT INTO tokens (id, image_id, valid_until, used) VALUES ($1,$2,now() + interval '15 minute', 0)`;
const consumeToken = `UPDATE tokens SET used=1 WHERE id=$1 AND image_id=$2 AND valid_until >= now() AND used=0`;
const deleteOldTokens = `DELETE FROM tokens WHERE valid_until < NOW() AND used=0`;

const shouldRunCleanup = () => Math.floor(Math.random() * 10) === 0;

export default (db) => {
  const promiseQuery = (query, vars) => {
    return new Promise((resolve, reject) => db.query(query, vars, (err, data) => err ? reject(err) : resolve(data)));
  };

  const cleanup = async() => {
    try {
      const result = await promiseQuery(deleteOldTokens, []);
      log('info', `Cleaned ${result.rowCount} tokens from the db`);
    } catch (e) {
      log('error', `Encountered error ${e} when cleaning up tokens`);
    }
  };
  return {
    createToken: async(id) => {
      const newToken = uuid();
      try {
        await promiseQuery(insertToken, [newToken, id]);
        log('info', 'Created token successfully');
        if (shouldRunCleanup()) {
          cleanup();
        }
        return newToken;
      } catch (e) {
        // Duplicate for the id
        log('error', e.stack);
        return null;
      }
    },
    consume: async(token, id) => {
      const vars = [token, id];
      try {
        const result = await promiseQuery(consumeToken, vars);
        return result.rowCount === 1;
      } catch (e) {
        log('error', e.stack);
        return false;
      }
    }
  };
};
