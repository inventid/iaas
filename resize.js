var http = require('http');
var gm = require('gm');
var fs = require('fs')

server = http.createServer(function (req, res) {
  if ( req.method === 'GET' ) {
    Image.get(req, res);
  } else if ( req.method === 'POST' && req.url === '/token' ) {
    createToken(req, res);
  } else if ( req.method === 'POST' ) {
    uploadImage(res, res);
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

  cache = Image.checkCache(fileName, fileType, resolutionX, resolutionY, res);
  // If true, it redirected the request
  if ( !cache ) {
    res.writeHead(200, {'Content-Type': supportedFileType(fileType)})
    Image.encode(fileName, fileType, resolutionX, resolutionY, res);
  }
}
Image.checkCache = function(fileName, fileType, resolutionX, resolutionY) {
  return false;
}
Image.encode = function(fileName, fileType, resolutionX, resolutionY, res ) {
  savedLocation = '/vagrant/'+fileName + '_' + resolutionX + 'x' + resolutionY + '.' + fileType;
  gm('/vagrant/example.png')
    .options({imageMagick: true})
    .resize(resolutionX, resolutionY)
    .stream(fileType, function streamOut(err, stdout, stderr) {
      stdout.pipe(res);
    });

 gm('/vagrant/example.png')
    .options({imageMagick: true})
    .resize(resolutionX, resolutionY)
    .toBuffer(fileType, function write(err,stream) {
      if ( !err) {
        file = fs.createWriteStream(savedLocation);
        file.write(stream);
        // Upload to AWS
      }
    }); 
}
Image.uploadToCache = function(fileName, fileType, resolutionX, resolutionY, imageData) {
  return null;
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

server.listen(1337, '10.0.2.15', function() {
	console.log("Server started listening");
});

