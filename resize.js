var http = require('http');
var gm = require('gm');
var fs = require('fs')
var config = require('config');
var AWS = require('aws-sdk');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('cache.db');

AWS.config.update({accessKeyId: config.get('aws.access_key'), secretAccessKey: config.get('aws.secret_key'), region: config.get('aws.region')});

// The AWS config needs to be set before this objectis created
var S3 = new AWS.S3();

// Re-use exisiting prepared queries
var insert = db.prepare("INSERT INTO images (id, x, y, file_type, url) VALUES (?,?,?,?,?)");
var select = db.prepare("SELECT url FROM images WHERE id=? AND x=? AND y=? AND file_type=?");

// Create the server
server = http.createServer(function (req, res) {
  if ( req.method === 'GET' ) {
    // Get an image
    Image.get(req, res);
  } else if ( req.method === 'POST' && req.url === '/token' ) {
    // Create a token for a client
    createToken(req, res);
  } else if ( req.method === 'POST' ) {
    // Process an upload
    Image.upload(req, res);
  } else {
    // Error if not supported
    log('error','405 Method not supported');
    res.writeHead(405, 'Method not supported');
    res.end();
  }
});

Image = {}
Image.get = function(req, res) {
  matches = req.url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.(.*)/);
  if ( matches === null ) {
    // Invalid URL
    log('error','404 Error for ' + res.url);
    res.writeHead(404, 'File not found');
    res.end();
    return;
  }
  
  fileName = matches[1];
  resolutionX = parseInt(matches[2]);
  resolutionY = parseInt(matches[3]);
  if ( matches[5] !== undefined ) {
    resolutionX *= parseInt(matches[5]);
    resolutionY *= parseInt(matches[5]);
  }
  fileType = matches[6].toLowerCase();
 
  if ( supportedFileType(fileType) === null ) {
    log('error','Filetype ' + fileType + ' is not supported');
    res.writeHead(415, 'Unsupported media type');
    res.end();
    return;
  }

  log('info','Requesting file ' + fileName + ' in ' + fileType + ' format in a ' + resolutionX + 'x' + resolutionY + 'px resolution');

  Image.checkCacheOrCreate(fileName, fileType, resolutionX, resolutionY, res);
}
Image.checkCacheOrCreate = function(fileName, fileType, resolutionX, resolutionY, res) {
  db.serialize(function() {
    // Check if it exists in the cache
    select.get([fileName, resolutionX, resolutionY, supportedFileType(fileType)],function(err,data) { 
      if ( !err && data ) {
        // It is in the cache, so redirect to there
        log('info','cache hit for ' + fileName + '.' + fileType + '(' + resolutionX + 'x' + resolutionY + 'px)');
        res.writeHead(302, {'Location': data.url});
        res.end();
        return;
      } else {
        // It does not exist in the cache, so generate and upload
        res.writeHead(200, {'Content-Type': supportedFileType(fileType)});
        Image.encodeAndUpload(fileName, fileType, resolutionX, resolutionY, res);
      }
    });
  });
}
Image.encodeAndUpload = function(fileName, fileType, resolutionX, resolutionY, res ) {
  file = config.get('originals_dir') + '/' + fileName;
  // Get the image and resize it
  gm(file)
    .options({imageMagick: true})
    .resize(resolutionX, resolutionY)
    .stream(fileType, function streamOut(err, stdout, stderr) {
      stdout.pipe(res);
    });

  gm(file)
    .options({imageMagick: true})
    .resize(resolutionX, resolutionY)
    .toBuffer(fileType, function write(err,stream) {
      if ( !err) {
        // This might mean we have generated the same file while an upload was in progress.
        // However this is still better than not being able to server the image
        Image.uploadToCache(fileName, fileType, resolutionX, resolutionY, stream);
      }
    }); 
}
Image.uploadToCache = function(fileName, fileType, resolutionX, resolutionY, content) {
  // Upload to AWS
  key = fileName + '_' + resolutionX + 'x' + resolutionY + '.' + fileType;
  upload_params = {
    Bucket: config.get('aws.bucket'),
    Key: key,
    ACL: 'public-read',
    Body: content,
    // We let the client cache this for a month
    Expires: (new Date()).setMonth(new Date().getMonth+1),
    ContentType: supportedFileType(fileType)
  };
  S3.putObject(upload_params, function(err,data) {
    if ( err ) {
      log('error','AWS upload error: ' + JSON.stringify(err));
    } else {
      log('info','Uploading of ' + key + ' went very well');
      db.serialize(function() {
        url = config.get('aws.bucket_url') + '/' + key;
        insert.run([fileName, resolutionX, resolutionY, supportedFileType(fileType), url],function(err) {
          if ( err ) { console.error(err); }
        });
      });
    }
  });

}
Image.upload = function(req, res) {
  // Upload the RAW image to AWS S3, stripped of its extension
  // TODO: Implement!
}

function supportedFileType(fileType) {
  switch ( fileType ) {
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

function createToken(req, res) {
  // Here we create a token which is valid for one single upload
  // This way we can directly send the file here and just a small json payload to the app
  // TODO: Implement!
}

function log(level,message) {
  obj = {
    datetime: new Date(),
    severity: level,
    message: message
  }
  console.log(JSON.stringify(obj));
}

// And listen±
server.listen(1337, '10.0.2.15', function() {
	console.log("Server started listening");
});

