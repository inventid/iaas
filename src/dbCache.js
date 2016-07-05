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
        log('error', e.stack);
        return null;
      }
    },
    async addToCache(params, url) {
      const vars = [params.name,
        params.width,
        params.height,
        params.fit,
        params.mime,
        url,
        Boolean(params.blur),
        new Date()
      ];

      try {
        const result = await promiseQuery(insertImage, vars);
        return result.rowCount === 1;
      } catch (e) {
        log('error', e.stack);
        return false;
      }
    }
  };
};
