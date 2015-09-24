"use strict";

module.exports = {
  isGetRequest: function isGetRequest(req) {
    return req.url !== '/healthcheck' && req.method === 'GET';
  },
  supportedFileType: function supportedFileType(fileType) {
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
  },
  isValidRequest: function isValidRequest(url) {
    return splitResizableUrl(url) !== null || splitOriginalUrl(url) !== null;
  },
  getImageParams: function getImageParams(req) {
    var matches = splitResizableUrl(req.url);
    var res = undefined;
    if (matches !== null) {
      res = {
        fileName: matches[1],
        resolutionX: parseInt(matches[2], 10),
        resolutionY: parseInt(matches[3], 10),
        fileType: matches[6].toLowerCase(),
        fit: 'clip'
      };

      if (matches[8] && ["clip", "crop"].indexOf(matches[8].toLowerCase()) > -1) {
        res.fit = matches[8].toLowerCase();
      }

      if (matches[5] !== undefined) {
        res.resolutionX *= parseInt(matches[5], 10);
        res.resolutionY *= parseInt(matches[5], 10);
      }
    } else {
      matches = splitOriginalUrl(req.url);
      res = {
        fileName: matches[1],
        fileType: matches[2].toLowerCase()
      };
    }

    return res;
  }
};

function splitResizableUrl(url) {
  return url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.([^?]*)(\?fit=(.*))?$/);
}

function splitOriginalUrl(url) {
  return url.match(/^\/(.*)\.([^.]+)$/);
}