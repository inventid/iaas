/**
 * This will return an array with matches, or null if no match was found
 *
 * [0] Original string, if matching succeeded
 * [1] the image name
 * [2] the x resolution
 * [3] the y resolution
 * [4] Some pointless retina thing, use [5] instead
 * [5] The scaling parameter (for retina)
 * [6] The file type
 * [7] The query string, dont use this, use [8] instead
 * [8] The format (either clip or crop or canvas)
 * @param url The url to parse
 * @returns {Array|{index: number, input: string}|*|{ID, CLASS, NAME, ATTR, TAG, CHILD, POS, PSEUDO}}
 */
function splitResizableUrl(url) {
  return url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.([^?]*)(\?fit=(.*))?$/);
}

/**
 * The will return an array with matches, or null of no match was found
 *
 * [0] The entire string, if matching succeeds
 * [1] The filename
 * [2] The file type
 * @param url The original url to parse
 * @returns {Array|{index: number, input: string}|*|{ID, CLASS, NAME, ATTR, TAG, CHILD, POS, PSEUDO}}
 */
function splitOriginalUrl(url) {
  return url.match(/^\/(.*)\.([^.]+)$/);
}

const UrlParsing = {
  isGetRequest(req) {
    return req.url !== '/healthcheck' && req.method === 'GET';
  },
  supportedFileType(fileType) {
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
  isValidRequest(url) {
    return splitResizableUrl(url) !== null || splitOriginalUrl(url) !== null;
  },
  getImageParams(req) {
    const matches = splitResizableUrl(req.url);
    let res;
    if (matches !== null) {
      res = {
        fileName: matches[1],
        resolutionX: parseInt(matches[2], 10),
        resolutionY: parseInt(matches[3], 10),
        fileType: matches[6].toLowerCase(),
        fit: 'clip'
      };

      if (matches[8] && ['clip', 'crop', 'canvas'].indexOf(matches[8].toLowerCase()) > -1) {
        res.fit = matches[8].toLowerCase();
      }

      if (matches[5] !== undefined) {
        res.resolutionX = res.resolutionX * parseInt(matches[5], 10);
        res.resolutionY = res.resolutionY * parseInt(matches[5], 10);
      }
    } else {
      const matchesOriginal = splitOriginalUrl(req.url);
      res = {
        fileName: matchesOriginal[1],
        fileType: matchesOriginal[2].toLowerCase()
      };
    }
    return res;
  }
};

export default UrlParsing;
