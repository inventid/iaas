import express from 'express';
import gm from 'gm';
import formidable from 'formidable';
import fs from 'fs-extra';
import config from 'config';
import AWS from 'aws-sdk';
import responseTime from 'response-time';
import bodyParser from 'body-parser';
import pg from 'pg';
import migrateAndStart from 'pg-migration';

const im = gm.subClass({imageMagick: true});

import token from './Token';
import log from './Log';
import helpers from'./Helpers';
import parsing from './UrlParsing';

const connectionString = `postgres://${config.get('postgresql.user')}:${config.get('postgresql.password')}@${config.get('postgresql.host')}/${config.get('postgresql.database')}`; //eslint-disable-line max-len
let db;
let dbDone;

// The AWS config needs to be set before this object is created
AWS.config.update({
  accessKeyId: config.get('aws.access_key'),
  secretAccessKey: config.get('aws.secret_key'),
  region: config.get('aws.region')
});
const S3 = new AWS.S3();

// Re-use exisiting prepared queries
const insertImage = 'INSERT INTO images (id, x, y, fit, file_type, url) VALUES ($1,$2,$3,$4,$5,$6)';
const selectImage = 'SELECT url FROM images WHERE id=$1 AND x=$2 AND y=$3 AND fit=$4 AND file_type=$5';

function logRequest(req, res, time) {
  const remoteIp = req.headers['x-forwarded-for'] || req.ip;
  const obj = {
    datetime: Date.now(),
    method: req.method,
    url: req.url,
    client: remoteIp,
    response_time: (time / 1e3),
    response_status: res.statusCode
  };
  if (parsing.isGetRequest(req)) {
    if (res.statusCode === 200) {
      obj.cache_hit = false;
    } else if (res.statusCode === 307) {
      obj.cache_hit = true;
    }
    try {
      const params = parsing.getImageParams(req);
      for (let param in params) {
        if (params.hasOwnProperty(param)) {
          obj[param] = params[param];
        }
      }
    } catch (e) {
      log.log('info', `Could not extract image parameters, might not have been an image request: ${req.url}`);
    }
  }
  log.log('debug', JSON.stringify(obj));
}

function getKeyFromParams(params) {
  return `${params.fileName}_${params.resolutionX}x${params.resolutionY}.${params.fit}.${params.fileType}`;
}

function correctlyResize(file, params, callback) {
  im(file).size((err, size) => {
    if (err) {
      return log.log('error', err);
    }
    const originalRatio = size.width / size.height;
    const newRatio = params.resolutionX / params.resolutionY;

    let resizeFactor;
    let cropX = 0;
    let cropY = 0;
    let cropWidth = size.width;
    let cropHeight = size.height;

    if (params.fit === 'crop') {
      if (originalRatio > newRatio) {
        resizeFactor = size.height / params.resolutionY;
        cropWidth = size.width / resizeFactor;
        cropHeight = params.resolutionY;
        cropX = (cropWidth - params.resolutionX) / 2;
      } else {
        resizeFactor = size.width / params.resolutionX;
        cropWidth = params.resolutionX;
        cropHeight = size.height / resizeFactor;
        cropY = (cropHeight - params.resolutionY) / 2;
      }
    }

    let workImageClient = im(file);
    if (resizeFactor) {
      workImageClient = workImageClient.resize(cropWidth, cropHeight).crop(params.resolutionX, params.resolutionY, cropX, cropY);
    } else {
      workImageClient = workImageClient.resize(params.resolutionX, params.resolutionY);
    }
    //Interlacing for png isn't efficient (both in filesize as render performance), so we only do it for jpg
    if (params.fileType === 'jpg') {
      workImageClient = workImageClient.interlace('Line');
    }
    callback(workImageClient);
  });
}

const Image = {
  get(req, res) {
    if (!parsing.isValidRequest(req.url)) {
      // Invalid URL
      return helpers.send404(res, req.url);
    }

    const params = parsing.getImageParams(req);

    if (parsing.supportedFileType(params.fileType) === null) {
      return helpers.send415(res, params.fileType);
    }

    let valid = true;
    if (params.resolutionX > config.get('constraints.max_width')) {
      params.resolutionX = config.get('constraints.max_width');
      valid = false;
    }
    if (params.resolutionY > config.get('constraints.max_height')) {
      params.resolutionY = config.get('constraints.max_height');
      valid = false;
    }

    if (!valid) {
      return helpers.send307DueTooLarge(res, params);
    }
    //HEAD requests won't be redirected automatically, so instead we'll always either return a 200
    //or a 404, indicating if the corresponding GET method will result in an image.
    if (req.method === 'HEAD') {
      Image.canServeFile(params, (canServe) => {
        if (canServe) {
          res.status(200).end();
        } else {
          res.status(404).end();
        }
      });
      return null;
    }
    log.log('info', `Requesting file ${params.fileName} in ${params.fileType} format in a ${params.resolutionX}x${params.resolutionY}px resolution`); //eslint-disable-line max-len

    Image.checkCacheOrCreate(params, res);
  },
  canServeFile(params, cb) {
    const file = `${config.get('originals_dir')}/${params.fileName}`;
    fs.access(file, fs.R_OK, (err) => {
      if (!err) {
        cb(true);
      } else {
        cb(false);
      }
    });
  },
  checkCacheOrCreate(params, res) {
    // Check if it exists in the cache
    db.query(selectImage, [params.fileName,
      params.resolutionX,
      params.resolutionY,
      params.fit,
      parsing.supportedFileType(params.fileType)
    ], (err, data) => {
      if (!err && data.rowCount === 1) {
        // It is in the cache, so redirect to there
        return helpers.send307DueToCache(res, params, data.rows[0].url);
      }

      // It does not exist in the cache, so generate and upload
      Image.encodeAndUpload(params, res);
    });
  },
  encodeAndUpload(params, res) {
    const file = `${config.get('originals_dir')}/${params.fileName}`;
    fs.access(file, (err) => {
      if (err) {
        log.log('warn', `File ${params.fileName} was requested but did not exist`);
        return helpers.send404(res, params.fileName);
      }

      // Get the image and resize it
      res.writeHead(200, {
        'Content-Type': parsing.supportedFileType(params.fileType),
        Expires: helpers.farFutureDate(),
        'Cache-Control': 'public'
      });

      // These files have already been oriented!
      correctlyResize(file, params, (resized) => {
        resized.stream(params.fileType, (err, stdout) => {
          const r = stdout.pipe(res);
          r.on('finish', () => {
            // This is to close the result while a background job will continue to process
            log.log('info', 'Finished sending a converted image');
            res.end();
          });
        });
      });

      correctlyResize(file, params, (resized) => {
        resized.toBuffer(params.fileType, (err, stream) => {
          if (!err) {
            // This might mean we have generated the same file while an upload was in progress.
            // However this is still better than not being able to server the image
            Image.uploadToCache(params, stream);
          }
        });
      });
    });
  },
  uploadToCache(params, content) {
    // Upload to AWS
    const key = getKeyFromParams(params);
    // AWS sets the etag as MD5 of the file already
    const upload_params = {
      Bucket: config.get('aws.bucket'),
      Key: key,
      ACL: 'public-read',
      Body: content,
      Expires: helpers.farFutureDate(),
      ContentType: parsing.supportedFileType(params.fileType),
      // We let any intermediate server cache this result as well
      CacheControl: 'public'
    };
    S3.putObject(upload_params, (err) => {
      if (err) {
        log.log('error', `AWS upload error: ${JSON.stringify(err)}`);
        return;
      }
      log.log('info', `Uploading of ${key} went very well`);
      const url = `${config.get('aws.bucket_url')}/${key}`;
      db.query(insertImage, [params.fileName,
        params.resolutionX,
        params.resolutionY,
        params.fit,
        parsing.supportedFileType(params.fileType), url
      ], (err) => {
        if (err) {
          log.log('error', err);
        }
      });
    });
  },
  upload(req, res) {
    // Upload the RAW image to disk, stripped of its extension
    // First check the token
    const sentToken = req.headers['x-token'];
    const matches = req.url.match(/^\/(.*)\.([^.]+)$/);
    log.log('info', `Requested image upload for image_id ${matches[1]} with token ${sentToken}`);
    if (!parsing.supportedFileType(matches[2])) {
      return helpers.send415(res, matches[2]);
    }

    // We support the file type
    token.consume(sentToken, matches[1], (err, dbResult) => {
        if (err || dbResult.rowCount !== 1) {
          return helpers.send403(res);
        }
        // And we support the filetype
        log.log('info', `Starting to write original file ${matches[1]}`);
        const form = new formidable.IncomingForm();

        form.parse(req, (err, fields, files) => {
          if (err) {
            return helpers.send500(res, err);
          }
          const temp_path = files.image.path;
          const destination_path = `${config.get('originals_dir')}/${matches[1]}`;

          im(temp_path)
            .autoOrient()
            .write(destination_path, (err) => {
              if (err) {
                return helpers.send500(res, err);
              }
              // Yup, we have to re-read the file, since the possible orientation is not taken into account
              im(destination_path)
                .size((err, value) => {
                  let original_height = null;
                  let original_width = null;
                  if (!err) {
                    // This is an intentional swallow of errors, since it does not affect the situation too much
                    original_height = value.height ? value.height : null;
                    original_width = value.width ? value.width : null;
                  }

                  res.json({
                    status: 'OK',
                    id: matches[1],
                    original_height: original_height,
                    original_width: original_width
                  }).end();
                  log.log('info', `Finished writing original file ${matches[1]}`);
                });
            });
        });
      }
    )
    ;
  },
  getOriginal(req, res) {
    const matches = parsing.getImageParams(req);
    log.log('info', `Requested original image ${matches.fileName} in format ${matches.fileType}`);
    if (!parsing.supportedFileType(matches.fileType)) {
      return helpers.send404(res, req.url);
    }
    const file = `${config.get('originals_dir')}/${matches.fileName}`;
    fs.access(file, fs.R_OK, (err) => {
      if (err) {
        log.log('warn', `Image ${matches.fileName} is not available locally`);
        return helpers.send404(res, file);
      }
      const headers = {
        'Content-Type': parsing.supportedFileType(matches.fileType),
        'Cache-Control': 'public',
        Etag: `${matches.fileName}_${matches.fileType}`,
        Expires: helpers.farFutureDate()
      };
      res.writeHead(200, headers);
      fs.readFile(file, (_, data) => {
        res.end(data);
      });
    });
  }
};

function startServer() {
  // Create the server
  const app = express();
  app.use(bodyParser.json());
  app.use(responseTime(logRequest));
  app.use(helpers.allowCrossDomain);
  app.get('/', (req, res) => {
    helpers.send404(res, '/', false);
  });
  app.get('/healthcheck', (req, res) => {
    helpers.serverStatus(res, dbDone);
  });
  app.get('/robots.txt', helpers.robotsTxt);
  app.get('/favicon.ico', (req, res) => {
    helpers.send404(res, 'favicon.ico');
  });
  app.get('/*_*_*_*x.*', Image.get);
  app.get('/*_*_*.*', Image.get);
  app.get('/*.*', Image.getOriginal);
  app.post('/token', token.create);
  app.post('/*', Image.upload);

  // And listen!
  const port = process.env.PORT || 1337; //eslint-disable-line no-process-env
  app.listen(port, () => {
    token.setDb(db);
    log.log('info', `Server started listening on port ${port}`);
  });
}

pg.connect(connectionString, (err, client, done) => {
  if (err) {
    log.log('error', `error fetching client from pool: ${err}`);
  } else {
    db = client;
    dbDone = done;

    migrateAndStart(db, './migrations', startServer);
  }
});
