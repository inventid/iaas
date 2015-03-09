'use strict';

var express = require('express');
var gm = require('gm');
var fs = require('fs');
var config = require('config');
var AWS = require('aws-sdk');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(config.get('db_file'));
var uuid = require('node-uuid');
var bodyParser = require('body-parser');

AWS.config.update({accessKeyId: config.get('aws.access_key'), secretAccessKey: config.get('aws.secret_key'), region: config.get('aws.region')});

// The AWS config needs to be set before this objectis created
var S3 = new AWS.S3();

// Re-use exisiting prepared queries
var insertImage = db.prepare("INSERT INTO images (id, x, y, file_type, url) VALUES (?,?,?,?,?)");
var selectImage = db.prepare("SELECT url FROM images WHERE id=? AND x=? AND y=? AND file_type=?");
var insertToken = db.prepare("INSERT INTO tokens (id, image_id, valid_until) VALUES (?,?,datetime('now','+15 minute'))");
var consumeToken = db.prepare("DELETE FROM tokens WHERE id=? AND image_id=? AND valid_until>= datetime('now')");
var deleteOldTokens = db.prepare("DELETE FROM tokens WHERE valid_until < datetime('now')");

// Central logging. console.log can be replaced by writing to a logfile for example
function log(level, message) {
    var obj = {
        datetime: new Date(),
        severity: level,
        message: message
    };
    console.log(JSON.stringify(obj));
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

var image = {};
image.get = function (req, res) {
    var matches = req.url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.(.*)/);
    if (matches === null) {
        // Invalid URL
        log('error', '404 Error for ' + res.url);
        res.writeHead(404, 'File not found');
        res.end();
        return;
    }

    var fileName = matches[1], resolutionX = parseInt(matches[2], 10), resolutionY = parseInt(matches[3], 10);
    if (matches[5] !== undefined) {
        resolutionX *= parseInt(matches[5], 10);
        resolutionY *= parseInt(matches[5], 10);
    }
    var fileType = matches[6].toLowerCase();

    if (supportedFileType(fileType) === null) {
        log('error', 'Filetype ' + fileType + ' is not supported');
        res.writeHead(415, 'Unsupported media type');
        res.end();
        return;
    }

    log('info', 'Requesting file ' + fileName + ' in ' + fileType + ' format in a ' + resolutionX + 'x' + resolutionY + 'px resolution');

    image.checkCacheOrCreate(fileName, fileType, resolutionX, resolutionY, res);
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
            log('warn','File ' + fileName + ' was requested but did not exist');
            return;
        }

        // Get the image and resize it
        res.writeHead(200, {'Content-Type': supportedFileType(fileType)});
        gm(file)
            .options({imageMagick: true})
            .resize(resolutionX, resolutionY)
            .stream(fileType, function (err, stdout, stderr) {
                var r = stdout.pipe(res);
                r.on('finish', function () {
                    // This is to close the result while a background job will continue to process
                    log('info','Finished sending a converted image');
                });
            });

        gm(file)
            .options({imageMagick: true})
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
    // Upload the RAW image to AWS S3, stripped of its extension
    // First check the token
    var sentToken = req.headers['x-token'];
    var matches = req.url.match(/^\/(.*)\.([^.]+)$/);
    if (supportedFileType(matches[2])) {
        // We support the file type
        consumeToken.run([sentToken, matches[1]], function (err) {
            if (!err && this.changes === 1) {
                // And we support the filetype
                log('info', 'Starting to write original file ' + matches[1]);
                var original = fs.createWriteStream(config.get('originals_dir') + '/' + matches[1]);
                var r = req.pipe(original);
                r.on('finish', function () {
                    log('info', 'Finished writing original file ' + matches[1]);
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.write(JSON.stringify({'status': 'OK', 'id': matches[1]}));
                    res.end();
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

var token = {};
token.create = function (req, res) {
    // Here we create a token which is valid for one single upload
    // This way we can directly send the file here and just a small json payload to the app
    var newToken = uuid.v4();
    if (!req.body.id) {
        res.writeHead(400, 'Bad request');
        res.end();
    }
    insertToken.run([newToken, req.body.id], function (err) {
        if (!err) {
            res.writeHead(200, {'Content-Type': 'application/json'});
            var responseObject = JSON.stringify({ token: newToken });
            res.write(responseObject);
            log('info', 'Created token successfully');
            if (token.shouldRunCleanup()) {
                token.cleanup();
            }
            res.end();
        } else {
            log('error', 'Error when generating token');
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

// Create the server
var app = express();
app.use(bodyParser.json());
app.get('/*', image.get);
app.post('/token', token.create);
app.post('/*', image.upload);

// And listen!
var server = app.listen(1337, function () {
    console.log("Server started listening");
});

