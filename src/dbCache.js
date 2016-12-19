import log from "./log";

const insertImage = 'INSERT INTO images (id, x, y, fit, file_type, url, blur, rendered_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
const selectImage = 'SELECT url FROM images WHERE id=$1 AND x=$2 AND y=$3 AND fit=$4 AND file_type=$5 AND blur=$6';

export default (db) => {
  const promiseQuery = (query, vars) => {
    return new Promise((resolve, reject) => db.query(query, vars, (err, data) => err ? reject(err) : resolve(data)));
  };
  return {
    async getFromCache(params) {
      const vars = [params.name,
        params.width,
        params.height,
        params.fit,
        params.mime,
        Boolean(params.blur)
      ];

      try {
        const result = await promiseQuery(selectImage, vars);
        if (result.rowCount && result.rowCount === 1) {
          // Cache hit
          return result.rows[0].url;
        }
        // Cache miss
        return null;
      } catch (e) {
        log('error', e.toString());
        return null;
      }
    },
    async addToCache(params, url, renderedAt) {
      const vars = [params.name,
        params.width,
        params.height,
        params.fit,
        params.mime,
        url,
        Boolean(params.blur),
        renderedAt
      ];

      try {
        const result = await promiseQuery(insertImage, vars);
        return result.rowCount === 1;
      } catch (e) {
        const message = e.toString();
        if (message.startsWith('duplicate key value violates unique constraint')) {
          // This is triggered if two images raced to be computed simultaneously and only one can be saved to the db
          // As a result, we do not consider this an error
          log('debug', 'Two images raced to be saved in the database. Persisted just one.');
          return true;
        }
        log('error', message);
        return false;
      }
    }
  };
};
