require("babel-polyfill");

import {native} from 'pg';
import migrateAndStart from "pg-migration";
import config from "config";
import log from '../log';

// Queries
const insertToken = `INSERT INTO tokens (id, image_id, valid_until, used) VALUES ($1,$2,now() + interval '15 minute', 0)`;
const consumeTokens = `UPDATE tokens SET used=1 WHERE id=$1 AND image_id=$2 AND valid_until >= now() AND used=0`;
const deleteOldTokens = `DELETE FROM tokens WHERE valid_until < NOW() AND used=0`;
const insertImage = 'INSERT INTO images (id, x, y, fit, file_type, url, blur, quality, rendered_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)';
const selectImage = 'SELECT url FROM images WHERE id=$1 AND x=$2 AND y=$3 AND fit=$4 AND file_type=$5 AND blur=$6 AND quality=$7'; //eslint-disable-line max-len

export default function postgresql() {
  const configs = {
    user: config.get('postgresql.user'),
    database: config.get('postgresql.database'),
    password: config.get('postgresql.password'),
    host: config.get('postgresql.host'),
    port: 5432,
    max: 5,
    idleTimeoutMillis: 30000
  };

  const pool = new native.Pool(configs);

  pool.on('error', function (err) {
    log('error', `idle client error ${err.message} ${err.stack}`);
  });

  async function queryPromise(query, vars) {
    return new Promise((resolve, reject) => pool.query(query, vars, (err, data) => err ? reject(err) : resolve(data)));
  }

  async function isDbAlive() {
    const testQuery = 'SELECT 1';
    try {
      const result = await queryPromise(testQuery, []);
      return Boolean(result.rowCount && result.rowCount === 1);
    } catch (e) {
      return false;
    }
  }

  async function cleanupTokens() {
    try {
      const result = await queryPromise(deleteOldTokens, []);
      log('info', `Cleaned ${result.rowCount} tokens from the db`);
    } catch (e) {
      log('error', `Encountered error ${e} when cleaning up tokens`);
    }
  }

  async function createToken(id, newToken) {
    try {
      const result = await queryPromise(insertToken, [newToken, id]);
      if (result.rowCount === 1) {
        return newToken;
      }
    } catch (e) {
      const message = e.toString();
      if (message.includes('duplicate key value violates unique constraint')) {
        // A client re-requested a previously requested image_id token
        log('warn', `Two image uploading requests for token raced to be saved in the database. Denying this one '${id}'.`);
      } else {
        log('error', message);
      }
    }
    return undefined;
  }

  async function consumeToken(token, id) {
    const vars = [token, id];
    try {
      const result = await queryPromise(consumeTokens, vars);
      return result.rowCount === 1;
    } catch (e) {
      log('error', e.stack);
      return false;
    }
  }

  async function getFromCache(params) {
    const vars = [params.name,
      params.width,
      params.height,
      params.fit,
      params.mime,
      Boolean(params.blur),
      params.quality
    ];

    const result = await queryPromise(selectImage, vars);
    if (result.rowCount && result.rowCount > 0) {
      // Cache hit
      return result.rows[0].url;
    }
    // Cache miss
    return null;
  }
  async function addToCache(params, url, renderedAt) {
    const vars = [params.name,
      params.width,
      params.height,
      params.fit,
      params.mime,
      url,
      Boolean(params.blur),
      params.quality,
      renderedAt
    ];

    try {
      const result = await queryPromise(insertImage, vars);
      return result.rowCount === 1;
    } catch (e) {
      const message = e.toString();
      if (message.includes('duplicate key value violates unique constraint')) {
        // This is triggered if two images raced to be computed simultaneously and only one can be saved to the db
        // As a result, we do not consider this an error
        log('debug', 'Two images raced to be saved in the database. Persisted just one.');
        return true;
      } else {
        log('error', message);
      }
      return false;
    }
  }

  function migrate(callback) {
    return pool.connect((err, client, done) => {
      if (err) {
        log('error', `error fetching client from pool ${err}`);
        callback(err);
      }
      migrateAndStart(client, './migrations', () => {
        log('info', 'Database migrated to newest version');
        done(null);
        callback(null);
      });
    });
  }

  async function close() {
    return await pool.end();
  }

  return {
    migrate,
    close,
    isDbAlive,
    createToken,
    consumeToken,
    cleanupTokens,
    addToCache,
    getFromCache
  };
}
