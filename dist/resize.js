"use strict";

var express = require('express');
var gm = require('gm');
var im = gm.subClass({ imageMagick: true });
var formidable = require('formidable');
var fs = require('fs-extra');
var config = require('config');
var AWS = require('aws-sdk');
var sqlite3 = require('sqlite3').verbose();
var responseTime = require('response-time');
var bodyParser = require('body-parser');
var token = require('./token.js');
var log = require('./log.js');
var helpers = require('./helpers.js');
var database = require('./database.js');
var parsing = require('./url-parsing.js');
var db;

// The AWS config needs to be set before this objectis created
AWS.config.update({ accessKeyId: config.get('aws.access_key'), secretAccessKey: config.get('aws.secret_key'), region: config.get('aws.region') });
var S3 = new AWS.S3();

// Re-use exisiting prepared queries
var insertImage;
var selectImage;

function logRequest(req, res, time) {
  var remoteIp = req.headers['x-forwarded-for'] || req.ip;
  var obj = {
    datetime: Date.now(),
    method: req.method,
    url: req.url,
    client: remoteIp,
    response_time: time / 1e3,
    response_status: res.statusCode
  };
  if (parsing.isGetRequest(req)) {
    if (res.statusCode === 200) {
      obj.cache_hit = false;
    } else if (res.statusCode === 307) {
      obj.cache_hit = true;
    }
    var params = parsing.getImageParams(req);
    for (var param in params) {
      obj[param] = params[param];
    }
  }
  log.log('debug', JSON.stringify(obj));
}

var image = {
  get: function get(req, res) {
    if (!parsing.isValidRequest(req.url)) {
      // Invalid URL
      return helpers.send404(res, req.url);
    }

    var params = parsing.getImageParams(req);

    if (parsing.supportedFileType(params.fileType) === null) {
      return helpers.send415(res, params.fileType);
    }

    var valid = true;
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
      image.canServeFile(params, function (canServe) {
        if (canServe) {
          res.status(200).end();
        } else {
          res.status(404).end();
        }
      });
      return;
    }
    log.log('info', 'Requesting file ' + params.fileName + ' in ' + params.fileType + ' format in a ' + params.resolutionX + 'x' + params.resolutionY + 'px resolution');

    image.checkCacheOrCreate(params, res);
  },
  canServeFile: function canServeFile(params, cb) {
    var file = config.get('originals_dir') + '/' + params.fileName;
    fs.exists(file, cb);
  },
  checkCacheOrCreate: function checkCacheOrCreate(params, res) {
    // Check if it exists in the cache
    selectImage.get([params.fileName, params.resolutionX, params.resolutionY, params.fit, parsing.supportedFileType(params.fileType)], function (err, data) {
      if (!err && data) {
        // It is in the cache, so redirect to there
        return helpers.send307DueToCache(res, params, data.url);
      }

      // It does not exist in the cache, so generate and upload
      image.encodeAndUpload(params, res);
    });
  },
  encodeAndUpload: function encodeAndUpload(params, res) {
    var file = config.get('originals_dir') + '/' + params.fileName;
    fs.exists(file, function (exists) {
      if (!exists) {
        log.log('warn', 'File ' + params.fileName + ' was requested but did not exist');
        return helpers.send404(res, params.fileName);
      }

      // Get the image and resize it
      res.writeHead(200, {
        'Content-Type': parsing.supportedFileType(params.fileType),
        'Expires': helpers.farFutureDate(),
        'Cache-Control': 'public'
      });

      // These files have already been oriented!
      correctlyResize(file, params, function (resized) {
        resized.stream(params.fileType, function (err, stdout) {
          var r = stdout.pipe(res);
          r.on('finish', function () {
            // This is to close the result while a background job will continue to process
            log.log('info', 'Finished sending a converted image');
            res.end();
          });
        });
      });

      correctlyResize(file, params, function (resized) {
        resized.toBuffer(params.fileType, function (err, stream) {
          if (!err) {
            // This might mean we have generated the same file while an upload was in progress.
            // However this is still better than not being able to server the image
            image.uploadToCache(params, stream);
          }
        });
      });
    });
  },
  uploadToCache: function uploadToCache(params, content) {
    // Upload to AWS
    var key = getKeyFromParams(params);
    // AWS sets the etag as MD5 of the file already
    var upload_params = {
      Bucket: config.get('aws.bucket'),
      Key: key,
      ACL: 'public-read',
      Body: content,
      Expires: helpers.farFutureDate(),
      ContentType: parsing.supportedFileType(params.fileType),
      // We let any intermediate server cache this result as well
      CacheControl: 'public'
    };
    S3.putObject(upload_params, function (err) {
      if (err) {
        log.log('error', 'AWS upload error: ' + JSON.stringify(err));
        return;
      }
      log.log('info', 'Uploading of ' + key + ' went very well');
      var url = config.get('aws.bucket_url') + '/' + key;
      insertImage.run([params.fileName, params.resolutionX, params.resolutionY, params.fit, parsing.supportedFileType(params.fileType), url], function (err) {
        if (err) {
          log.log('error', err);
        }
      });
    });
  },
  upload: function upload(req, res) {
    // Upload the RAW image to disk, stripped of its extension
    // First check the token
    var sentToken = req.headers['x-token'];
    var matches = req.url.match(/^\/(.*)\.([^.]+)$/);
    log.log('info', 'Requested image upload for image_id ' + matches[1] + ' with token ' + sentToken);
    if (!parsing.supportedFileType(matches[2])) {
      return helpers.send415(res, matches[2]);
    }

    // We support the file type
    token.consume(sentToken, matches[1], function (err) {
      if (err || this.changes !== 1) {
        return helpers.send403(res);
      }
      // And we support the filetype
      log.log('info', 'Starting to write original file ' + matches[1]);
      var form = new formidable.IncomingForm();

      form.parse(req, function (err, fields, files) {
        if (err) {
          return helpers.send500(res, err);
        }
        var temp_path = files.image.path;
        var destination_path = config.get('originals_dir') + '/' + matches[1];

        im(temp_path).autoOrient().write(destination_path, function (err) {
          if (err) {
            return helpers.send500(res, err);
          }
          // Yup, we have to re-read the file, since the possible orientation is not taken into account
          im(destination_path).size(function (err, value) {
            var original_height = null;
            var original_width = null;
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
            });
            res.end();
            log.log('info', 'Finished writing original file ' + matches[1]);
          });
        });
      });
    });
  },
  getOriginal: function getOriginal(req, res) {
    var matches = parsing.getImageParams(req);
    log.log('info', "Requested original image " + matches.fileName + " in format " + matches.fileType);
    if (parsing.supportedFileType(matches.fileType)) {
      (function () {
        var file = config.get('originals_dir') + '/' + matches.fileName;
        fs.exists(file, function (exists) {
          if (!exists) {
            return helpers.send404(res, file);
          }
          var headers = {
            'Content-Type': parsing.supportedFileType(matches.fileType),
            'Cache-Control': 'public',
            'Etag': matches.fileName + '_' + matches.fileType,
            'Expires': helpers.farFutureDate()
          };
          res.writeHead(200, headers);
          fs.readFile(file, function (err, data) {
            res.end(data);
          });
        });
      })();
    }
  }
};

function correctlyResize(file, params, callback) {
  im(file).size(function (err, size) {
    if (err) {
      return log.log('error', err);
    }
    var originalRatio = size.width / size.height;
    var newRatio = params.resolutionX / params.resolutionY;

    var resizeFactor;
    var cropX = 0;
    var cropY = 0;
    var cropWidth = size.width;
    var cropHeight = size.height;

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

    var workImageClient = im(file);
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

function getKeyFromParams(params) {
  return params.fileName + '_' + params.resolutionX + 'x' + params.resolutionY + '.' + params.fit + '.' + params.fileType;
}

function startServer() {
  // Set the queries
  insertImage = db.prepare("INSERT INTO images (id, x, y, fit, file_type, url) VALUES (?,?,?,?,?,?)");
  selectImage = db.prepare("SELECT url FROM images WHERE id=? AND x=? AND y=? AND fit=? AND file_type=?");

  // Create the server
  var app = express();
  app.use(bodyParser.json());
  app.use(responseTime(logRequest));
  app.use(helpers.allowCrossDomain);
  app.get('/healthcheck', helpers.serverStatus);
  app.get('/robots.txt', helpers.robotsTxt);
  app.get('/favicon.ico', function (req, res) {
    helpers.send404(res, 'favicon.ico');
  });
  app.get('/*_*_*_*x.*', image.get);
  app.get('/*_*_*.*', image.get);
  app.get('/*.*', image.getOriginal);
  app.post('/token', token.create);
  app.post('/*', image.upload);

  // And listen!
  var port = process.env.PORT || 1337;
  app.listen(port, function () {
    token.setDb(db);
    log.log('info', 'Server started listening on port ' + port);
  });
}

try {
  fs.statSync(config.get('db_file'));
  log.log('info', "Using db file: " + config.get('db_file'));
  db = new sqlite3.Database(config.get('db_file'));
  startServer();
} catch (e) {
  log.log('error', e);
  db = new sqlite3.Database(config.get('db_file'));
  database.prepareDb(db, startServer);
}