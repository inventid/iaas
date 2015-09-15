'use strict';

var express = require('express');
var gm = require('gm');
var formidable = require('formidable');
var fs = require('fs-extra');
var config = require('config');
var AWS = require('aws-sdk');
var sqlite3 = require('sqlite3').verbose();
var responseTime = require('response-time')
var uuid = require('node-uuid');
var bodyParser = require('body-parser');
var db;

AWS.config.update({accessKeyId: config.get('aws.access_key'), secretAccessKey: config.get('aws.secret_key'), region: config.get('aws.region')});

// The AWS config needs to be set before this objectis created
var S3 = new AWS.S3();

// Re-use exisiting prepared queries
var insertImage;
var selectImage;
var insertToken;
var consumeToken;
var deleteOldTokens;

function prepareDb(callback) {
  db.serialize(function () {
    console.log("Creating the db schema");
    try {
      db.run("CREATE TABLE images (id VARCHAR(255), x INT(6), y INT(6), file_type VARCHAR(8), url VARCHAR(255))");
      db.run("CREATE UNIQUE INDEX unique_image ON images(id,x,y,file_type)");

      db.run("CREATE TABLE tokens ( id VARCHAR(255), image_id VARCHAR(255), valid_until TEXT, used INT(1))");
      db.run("CREATE UNIQUE INDEX unique_token ON tokens(id)");
      db.run("CREATE UNIQUE INDEX unique_image_request ON tokens(image_id)");
      db.run("CREATE INDEX token_date ON tokens(id, valid_until, used)");
      console.log("Doing the callback from prepareDb");
      callback();
    } catch (e) {
      console.error(e);
    }
  });
}

// Central logging. console.log can be replaced by writing to a logfile for example
function log(level, message) {
  var obj = {
    datetime: Date.now(),
    severity: level,
    message: message
  };
  console.log(JSON.stringify(obj));
}

function logRequest(req, res, time) {
  var remoteIp = req.headers['x-forwarded-for'] || req.ip;
  var obj = {
    datetime: Date.now(),
    method: req.method,
    url: req.url,
    client: remoteIp,
    response_time: (time / 1e3),
    response_status: res.statusCode
  };
  if (isGetRequest(req, res)) {
    if (res.statusCode === 200) {
      obj.cache_hit = false;
    } else if (res.statusCode === 307) {
      obj.cache_hit = true
    }
    var imageParams = getImageParams(req.url);
    for (var param in imageParams) {
      obj[param] = imageParams[param];
    }
  }
  console.log(JSON.stringify(obj));
}

function isGetRequest(req, res) {
  return req.url !== '/healthcheck' && req.method === 'GET';
}

function supportedFileType(fileType) {
  switch (fileType) {
    case 'jpg':
    case 'jpeg':
    case 'jfif':
    case 'jpe':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return null;
  }
}

function isValidRequest(url) {
  return splitUrl(url) !== null;
}

function splitUrl(url) {
  return url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.(.*)/);
}

function getImageParams(url) {
  var matches = splitUrl(url);
  var res;
  if (matches !== null) {
    res = {
      fileName: matches[1],
      resolutionX: parseInt(matches[2], 10),
      resolutionY: parseInt(matches[3], 10),
      fileType: matches[6].toLowerCase()
    };

    if (matches[5] !== undefined) {
      res.resolutionX *= parseInt(matches[5], 10);
      res.resolutionY *= parseInt(matches[5], 10);
    }
  } else {
    matches = url.match(/^\/(.*)\.([^.]+)$/);
    res = {
      fileName: matches[1],
      fileType: matches[2].toLowerCase()
    };
  }
  return res;
}

var image = {};
image.get = function (req, res) {
  if (!isValidRequest(req.url)) {
    // Invalid URL
    log('error', '404 Error for ' + res.url);
    res.writeHead(404, 'File not found');
    res.end();
    return;
  }

  var params = getImageParams(req.url);

  if (supportedFileType(params.fileType) === null) {
    log('error', 'Filetype ' + params.fileType + ' is not supported');
    res.writeHead(415, 'Unsupported media type');
    res.end();
    return;
  }

  if (params.resolutionX < 0 || params.resolutionY < 0 || params.resolutionX > config.get('constraints.max_width') || params.resolutionY > config.get('constraints.max_height')) {
    res.writeHead(400, 'Bad request');
    res.end('The requested image size falls outside of the allowed boundaries of this service.');
    return;
  }

  log('info', 'Requesting file ' + params.fileName + ' in ' + params.fileType + ' format in a ' + params.resolutionX + 'x' + params.resolutionY + 'px resolution');

  image.checkCacheOrCreate(params.fileName, params.fileType, params.resolutionX, params.resolutionY, res);
};
image.checkCacheOrCreate = function (fileName, fileType, resolutionX, resolutionY, res) {
  // Check if it exists in the cache
  selectImage.get([fileName, resolutionX, resolutionY, supportedFileType(fileType)], function (err, data) {
    if (!err && data) {
      // It is in the cache, so redirect to there
      log('info', 'cache hit for ' + fileName + '.' + fileType + '(' + resolutionX + 'x' + resolutionY + 'px)');
      res.writeHead(307, {'Location': data.url, 'Cache-Control': 'public'});
      res.end();
      return;
    }
    // It does not exist in the cache, so generate and upload
    image.encodeAndUpload(fileName, fileType, resolutionX, resolutionY, res);
  });
};
image.encodeAndUpload = function (fileName, fileType, resolutionX, resolutionY, res) {
  var file = config.get('originals_dir') + '/' + fileName;
  fs.exists(file, function (exists) {
    if (!exists) {
      res.writeHead('404', 'File not found');
      res.end();
      log('warn', 'File ' + fileName + ' was requested but did not exist');
      return;
    }

    // Get the image and resize it
    res.writeHead(200, {'Content-Type': supportedFileType(fileType)});
    gm(file)
      .options({imageMagick: true})
      .autoOrient()
      .resize(resolutionX, resolutionY)
      .stream(fileType, function (err, stdout, stderr) {
        var r = stdout.pipe(res);
        r.on('finish', function () {
          // This is to close the result while a background job will continue to process
          log('info', 'Finished sending a converted image');
          res.end();
        });
      });

    gm(file)
      .options({imageMagick: true})
      .autoOrient()
      .resize(resolutionX, resolutionY)
      .toBuffer(fileType, function (err, stream) {
        if (!err) {
          // This might mean we have generated the same file while an upload was in progress.
          // However this is still better than not being able to server the image
          image.uploadToCache(fileName, fileType, resolutionX, resolutionY, stream);
        }
      });
  });
};
image.uploadToCache = function (fileName, fileType, resolutionX, resolutionY, content) {
  // Upload to AWS
  var key = fileName + '_' + resolutionX + 'x' + resolutionY + '.' + fileType;
  var upload_params = {
    Bucket: config.get('aws.bucket'),
    Key: key,
    ACL: 'public-read',
    Body: content,
    // We let the client cache this for a month
    Expires: (new Date()).setMonth(new Date().getMonth() + 1) / 1000,
    ContentType: supportedFileType(fileType),
    // We let any intermediate server cache this result as well
    CacheControl: 'public'
  };
  S3.putObject(upload_params, function (err, data) {
    if (err) {
      log('error', 'AWS upload error: ' + JSON.stringify(err));
    } else {
      log('info', 'Uploading of ' + key + ' went very well');
      var url = config.get('aws.bucket_url') + '/' + key;
      insertImage.run([fileName, resolutionX, resolutionY, supportedFileType(fileType), url], function (err) {
        if (err) {
          console.error(err);
        }
      });
    }
  });
};
image.upload = function (req, res) {
  // Upload the RAW image to disk, stripped of its extension
  // First check the token
  var sentToken = req.headers['x-token'];
  var matches = req.url.match(/^\/(.*)\.([^.]+)$/);
  log('info', "Requested image upload for image_id " + matches[1] + " with token " + sentToken);
  if (supportedFileType(matches[2])) {
    // We support the file type
    consumeToken.run([sentToken, matches[1]], function (err) {
      if (!err && this.changes === 1) {
        // And we support the filetype
        log('info', 'Starting to write original file ' + matches[1]);
        var form = new formidable.IncomingForm();

        form.parse(req, function (err, fields, files) {
          if (err) {
            console.error(err);
            res.writeHead(500, 'Internal server error');
            res.end(JSON.stringify(err));
            return;
          }
          var temp_path = files.image.path;
          var destination_path = config.get('originals_dir') + '/' + matches[1];
          console.log(err, files, destination_path);

          gm(temp_path).options({imageMagick: true})
            .autoOrient()
            .write(destination_path, function (err) {
              if (err) {
                console.error(err);
                res.writeHead(500, 'Internal server error');
                res.end(JSON.stringify(err));
                return;
              }
              // Yup, we have to re-read the file, since the possible orientation is not taken into account
              gm(destination_path).options({imageMagick: true})
                .size(function (err, value) {
                  var original_height = null;
                  var original_width = null;
                  if (!err) {
                    // This is an intentional swallow of errors, since it does not affect the situation too much
                    original_height = value.height ? value.height : null;
                    original_width = value.width ? value.width : null;
                  }

                  res.writeHead(200, {'Content-Type': 'application/json'});
                  res.write(JSON.stringify({
                      status: 'OK',
                      id: matches[1],
                      original_height: original_height,
                      original_width: original_width
                    })
                  );
                  res.end();
                  log('info', 'Finished writing original file ' + matches[1]);
                });

            });

        });


      } else {
        log('warn', 'Invalid or expired token used for upload');
        res.writeHead('403', 'Forbidden');
        res.end();
      }
    });
  } else {
    res.writeHead(415, 'Image type not supported');
    res.end();
  }
};
image.getOriginal = function (req, res) {
  var matches = req.url.match(/^\/(.*)\.([^.]+)$/);
  log('info', "Requested original image " + matches[1] + " in format " + matches[2]);
  if (supportedFileType(matches[2])) {
    var file = config.get('originals_dir') + '/' + matches[1];
    fs.exists(file, function (exists) {
      if (!exists) {
        res.writeHead('404', 'File not found');
        res.end();
        log('warn', 'File ' + matches[1] + ' was requested but did not exist');
        return;
      }

      // Get the image and resize it
      res.writeHead(200, {'Content-Type': supportedFileType(matches[2])});
      fs.readFile(file, function (err, data) {
        res.end(data);
      });
    });
  }
};

var token = {};
token.create = function (req, res) {
  // Here we create a token which is valid for one single upload
  // This way we can directly send the file here and just a small json payload to the app
  var newToken = uuid.v4();
  if (!req.body.id) {
    res.writeHead(400, 'Bad request');
    res.end();
    return;
  }
  // Ensure the id wasnt requested or used previously
  insertToken.run([newToken, req.body.id], function (err) {
    if (!err) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      var responseObject = JSON.stringify({token: newToken});
      res.write(responseObject);
      log('info', 'Created token successfully');
      if (token.shouldRunCleanup()) {
        token.cleanup();
      }
      res.end();
    } else {
      res.writeHead(403, 'Forbidden');
      res.write(JSON.stringify({error: 'The requested image_id is already requested'}));
      res.end();
    }
  });
};
token.shouldRunCleanup = function () {
  return Math.floor(Math.random() * 10) === 0;
};
token.cleanup = function () {
  log('info', 'Doing a token cleanup');
  deleteOldTokens.run([], function (err, data) {
    if (!err) {
      log('info', 'Cleaned ' + this.changes + ' tokens from the db');
    } else {
      log('error', 'Encountered error ' + err + ' when cleaning up tokens');
    }
  });
};

function serverStatus(req, res) {
  res.writeHead(200, 'OK');
  res.write('OK');
  res.end();
  log('info', 'healthcheck performed');
}

function robotsTxt(req, res) {
  res.writeHead(200, 'OK');
  if (config.has('allow_indexing') && config.get('allow_indexing')) {
    res.write("User-agent: *\nAllow: /");
  } else {
    res.write("User-agent: *\nDisallow: /");
  }
  res.end();
  log('info', 'robots.txt served');
}

function startServer() {
  // Set the queries
  insertImage = db.prepare("INSERT INTO images (id, x, y, file_type, url) VALUES (?,?,?,?,?)");
  selectImage = db.prepare("SELECT url FROM images WHERE id=? AND x=? AND y=? AND file_type=?");
  insertToken = db.prepare("INSERT INTO tokens (id, image_id, valid_until, used) VALUES (?,?,datetime('now','+15 minute'), 0)");
  consumeToken = db.prepare("UPDATE tokens SET used=1 WHERE id=? AND image_id=? AND valid_until>= datetime('now') AND used=0");
  deleteOldTokens = db.prepare("DELETE FROM tokens WHERE valid_until < datetime('now') AND used=0");

  // Create the server
  var app = express();
  app.use(bodyParser.json());
  app.use(responseTime(logRequest));
  app.get('/healthcheck', serverStatus);
  app.get('/robots.txt', robotsTxt);
  app.get('/*_*_*_*x.*', image.get);
  app.get('/*_*_*.*', image.get);
  app.get('/*.*', image.getOriginal);
  app.post('/token', token.create);
  app.post('/*', image.upload);


  // And listen!
  var server = app.listen(1337, function () {
    console.log("Server started listening");
  });
}

try {
  fs.statSync(config.get('db_file'));
  console.log("Using db file: " + config.get('db_file'));
  db = new sqlite3.Database(config.get('db_file'));
  startServer();
} catch (e) {
  console.log(e);
  db = new sqlite3.Database(config.get('db_file'));
  prepareDb(startServer);
}

