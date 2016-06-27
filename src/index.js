import express from "express";
import gm from "gm";
import formidable from "formidable";
import fs from "fs-extra";
import config from "config";
import responseTime from "response-time";
import bodyParser from "body-parser";
import pg from "pg";
import migrateAndStart from "pg-migration";
import uuid from "uuid";
import Token from "./Token";
import log from "./Log";
import helpers from "./Helpers";
import parsing from "./UrlParsing";
import S3 from "./AwsS3.js";
import requestLogger from "./RequestLogger.js";

const im = gm.subClass({imageMagick: true});

const connectionString = `postgres://${config.get('postgresql.user')}:${config.get('postgresql.password')}@${config.get('postgresql.host')}/${config.get('postgresql.database')}`; //eslint-disable-line max-len
let token;
let db;

// Re-use existing prepared queries
const insertImage = 'INSERT INTO images (id, x, y, fit, file_type, url, blur) VALUES ($1,$2,$3,$4,$5,$6,$7)';
const selectImage = 'SELECT url FROM images WHERE id=$1 AND x=$2 AND y=$3 AND fit=$4 AND file_type=$5 AND blur=$6';

// This method creates the URL key from the parameters of the image
function getKeyFromParams(params) {
  return `${params.fileName}_${params.resolutionX}x${params.resolutionY}.${params.fit}.b-${params.blur}.${params.fileType}`;
}

function optionallyBlur(workImageClient, params) {
  if (params.blur) {
    workImageClient = workImageClient.blur(15, 7);
  }
  return workImageClient;
}

// This methods handles the correct resizing of an image
function correctlyResize(file, params, callback) {
  let workImageClient = im(file);
  //Interlacing for png isn't efficient (both in filesize as render performance), so we only do it for jpg
  if (params.fileType === 'jpg') {
    workImageClient = workImageClient.interlace('Line');
  }

  // Determine how to crop this
  if (params.fit === 'crop') {
    workImageClient = workImageClient.resize(params.resolutionX, params.resolutionY, '^');
    const tmpFile = `/tmp/${uuid.v4()}`;
    workImageClient.write(tmpFile, (err) => {
      if (err) {
        log.log('error', `Could not write tempFile: ${err}`);
        return;
      }
      workImageClient = im(tmpFile);
      workImageClient.size((err, newSize) => {
        if (err) {
          log.log('error', `Could not resize tempFile: ${err}`);
          return;
        }
        workImageClient = workImageClient
          .repage(newSize.width, newSize.height, 0, 0)
          .gravity('Center')
          .crop(params.resolutionX, params.resolutionY, '!');
        workImageClient = optionallyBlur(workImageClient, params);
        callback(workImageClient);
      });
    });
  } else {
    workImageClient = workImageClient.resize(params.resolutionX, params.resolutionY);
    if (params.fit === 'canvas') {
      workImageClient = workImageClient.gravity('Center').extent(params.resolutionX, params.resolutionY);
    }
    workImageClient = optionallyBlur(workImageClient, params);
    callback(workImageClient);
  }
}

const Image = {
  get(req, res) {
    if (!parsing.isValidRequest(req.url, req.query)) {
      // Invalid URL
      helpers.send404(res, req.url);
      return;
    }

    const params = parsing.getImageParams(req);

    if (parsing.supportedFileType(params.fileType) === null) {
      helpers.send415(res, params.fileType);
      return;
    }

    let valid = true;

    // Check if we are allowed to serve an image of this size and optionally redirect
    const providedRatio = params.resolutionX / params.resolutionY;
    if (params.resolutionX > config.get('constraints.max_width')) {
      params.resolutionX = config.get('constraints.max_width');
      if (params.fit === 'crop') {
        params.resolutionY = params.resolutionX / providedRatio;
      }
      valid = false;
    }
    if (params.resolutionY > config.get('constraints.max_height')) {
      params.resolutionY = config.get('constraints.max_height');
      if (params.fit === 'crop') {
        params.resolutionX = params.resolutionY * providedRatio;
      }
      valid = false;
    }
    if (!valid) {
      helpers.send307DueTooLarge(res, params);
      return;
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
      return;
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
      parsing.supportedFileType(params.fileType),
      params.blur
    ], (err, data) => {
      if (!err && data.rowCount === 1) {
        // It is in the cache, so redirect to there
        helpers.send307DueToCache(res, params, data.rows[0].url);
        return;
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
        helpers.send404(res, params.fileName);
        return;
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
    const uploadParams = {
      Bucket: config.get('aws.bucket'),
      Key: key,
      ACL: 'public-read',
      Body: content,
      Expires: helpers.farFutureDate(),
      ContentType: parsing.supportedFileType(params.fileType),
      // We let any intermediate server cache this result as well
      CacheControl: 'public'
    };
    S3.putObject(uploadParams, (err) => {
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
        parsing.supportedFileType(params.fileType), url, params.blur
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
    const matches = req.path.match(/^\/(.*)\.([^.]+)$/);
    log.log('info', `Requested image upload for image_id ${matches[1]} with token ${sentToken}`);
    if (!parsing.supportedFileType(matches[2])) {
      helpers.send415(res, matches[2]);
      return;
    }

    // We support the file type
    token.consume(sentToken, matches[1], (err, dbResult) => {
        if (err || dbResult.rowCount !== 1) {
          helpers.send403(res);
          return;
        }
        // And we support the filetype
        log.log('info', `Starting to write original file ${matches[1]}`);
        const form = new formidable.IncomingForm();

        form.parse(req, (err, fields, files) => {
          if (err) {
            helpers.send500(res, err);
            return;
          }
          const temp_path = files.image.path;
          const destination_path = `${config.get('originals_dir')}/${matches[1]}`;

          let oriented = im(temp_path).autoOrient();

          const saveOriginal = (oriented) => {
            oriented.write(destination_path, (err) => {
              if (err) {
                helpers.send500(res, err);
                return;
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
          };
          if (req.query.x && req.query.y && req.query.width && req.query.height) {
            const x = parseInt(req.query.x, 10);
            const y = parseInt(req.query.y, 10);
            const width = parseInt(req.query.width, 10);
            const height = parseInt(req.query.height, 10);
            if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
              helpers.send400('Given crop parameters are invalid');
              return;
            }
            saveOriginal(oriented.crop(width, height, x, y));
            return;
          }
          saveOriginal(oriented);
        });
      }
    )
    ;
  },
  getOriginal(req, res) {
    const matches = parsing.getImageParams(req);
    log.log('info', `Requested original image ${matches.fileName} in format ${matches.fileType}`);
    if (!parsing.supportedFileType(matches.fileType)) {
      helpers.send404(res, req.url);
      return;
    }
    const file = `${config.get('originals_dir')}/${matches.fileName}`;
    fs.access(file, fs.R_OK, (err) => {
      if (err) {
        log.log('warn', `Image ${matches.fileName} is not available locally`);
        helpers.send404(res, file);
        return;
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
  token = Token(db);

  // Create the server
  const app = express();

  app.use(bodyParser.json());
  app.use(responseTime(requestLogger));
  app.use(helpers.allowCrossDomain);

  app.get('/', (req, res) => helpers.send404(res, '/', false));
  app.get('/healthcheck', (req, res) => helpers.serverStatus(res, true));
  app.get('/robots.txt', helpers.robotsTxt);
  app.get('/favicon.ico', (req, res) => helpers.send404(res, 'favicon.ico'));

  app.get('/*_*_*_*x.*', Image.get);
  app.get('/*_*_*.*', Image.get);
  app.get('/*.*', Image.getOriginal);
  app.post('/token', token.create);
  app.post('/*', Image.upload);

  // And listen!
  const port = process.env.PORT || 1337; //eslint-disable-line no-process-env
  app.listen(port, () => log.log('info', `Server started listening on port ${port}`));
}

pg.connect(connectionString, (err, client) => {
  if (err) {
    log.log('error', `error fetching client from pool: ${err}`);
  } else {
    db = client;
    migrateAndStart(db, './migrations', startServer);
  }
});
