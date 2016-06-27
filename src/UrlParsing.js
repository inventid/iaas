/**
 * This will return an object with matches, or null if no match was found
 *
 * original: Original string, if matching succeeded
 * name: the image name
 * width: the x resolution
 * height: the y resolution
 * scaling: The scaling parameter (for retina)
 * type: The file type
 * fit: The format (either clip or crop or canvas)
 * blur: Whether to blur the image or not
 * @param url The url to parse
 * @returns {Array|{index: number, input: string}|*|{ID, CLASS, NAME, ATTR, TAG, CHILD, POS, PSEUDO}}
 */
function splitResizableUrl(url, params) {
  const matches = url.match(/^\/(.*)_(\d+)_(\d+)(_(\d+)x)?\.([^?]*)$/);
  if (!matches) {
    return null;
  }
  // fit and blur are default here which will be overridden later
  const res = {
    original: matches[0],
    name: matches[1],
    width: matches[2],
    height: matches[3],
    scaling: matches[5],
    type: matches[6].toLowerCase(),
    fit: 'clip',
    blur: false
  };
  if (params.fit && ['clip', 'crop', 'canvas'].indexOf(params.fit.toLowerCase())) {
    res.fit = params.fit.toLowerCase();
  }
  if (params.blur && params.blur.toLowerCase() === 'true') {
    res.blur = true;
  }

  return res;
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
  isValidRequest(url, params) {
    return splitResizableUrl(url, params) !== null || splitOriginalUrl(url) !== null;
  },
  getImageParams(req) {
    const matches = splitResizableUrl(req.path, req.query);
    let res;
    if (matches !== null) {
      res = {
        fileName: matches.name,
        resolutionX: parseInt(matches.width, 10),
        resolutionY: parseInt(matches.height, 10),
        fileType: matches.type.toLowerCase(),
        fit: matches.fit,
        blur: matches.blur
      };

      if (matches.scaling !== undefined) {
        res.resolutionX = res.resolutionX * parseInt(matches.scaling, 10);
        res.resolutionY = res.resolutionY * parseInt(matches.scaling, 10);
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
