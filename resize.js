var http = require('http');
var gm = require('gm');
var fs = require('fs')

server = http.createServer(function (req, res) {
  if ( req.method === 'GET' ) {
    Image.get(req, res);
  } else if ( req.method === 'POST' && req.url === '/token' ) {
    createToken(req, res);
  } else if ( req.method === 'POST' ) {
    Image.upload(req, res);
  } else {
    res.writeHead(405, 'Method not supported');
  }
});

Image = {}
Image.get = function(req, res) {
  matches = req.url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.(.*)/);
  if ( matches === null ) {
    console.log('404 Error for ' + res.url);
    return res.writeHead(404, 'File not found');
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
    console.log('Filetype ' + fileType + ' is not supported');
    return res.writeHead(415, 'Unsupported media type');
  }

  console.log('Requesting file ' + fileName + ' in ' + fileType + ' format in a ' + resolutionX + 'x' + resolutionY + 'px resolution');

  if ( !Image.checkCache(fileName, fileType, resolutionX, resolutionY, res) ) {
    // If we get here, the file was not in the cache
    res.writeHead(200, {'Content-Type': supportedFileType(fileType)})
    Image.encode(fileName, fileType, resolutionX, resolutionY, res);
  }
}
Image.checkCache = function(fileName, fileType, resolutionX, resolutionY) {
  return false;
}
Image.encode = function(fileName, fileType, resolutionX, resolutionY, res ) {
  savedLocation = '/vagrant/'+fileName + '_' + resolutionX + 'x' + resolutionY + '.' + fileType;
  resized = gm('/vagrant/example.image')
    .options({imageMagick: true})
    .resize(resolutionX, resolutionY);
  resized.stream(fileType, function streamOut(err, stdout, stderr) {
      stdout.pipe(res);
      //res.end();
    });

  resized.toBuffer(fileType, function write(err,stream) {
      if ( !err) {
        file = fs.createWriteStream(savedLocation);
        file.write(stream);
        // Upload to AWS
        Image.uploadToCache(fileName, fileType, resolutionX, resolutionY, savedLocation);
      }
    }); 
}
Image.uploadToCache = function(fileName, fileType, resolutionX, resolutionY, content) {
  return null;
}
Image.upload = function(req, res) {
  // Upload the RAW image to AWS S3, stripped of its extension
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
}

server.listen(1337, '10.0.2.15', function() {
	console.log("Server started listening");
});

