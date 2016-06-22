import parsing from './UrlParsing';
import log from './Log';

function logRequest(req, res, time) {
  const remoteIp = req.headers['x-forwarded-for'] || req.ip;
  const obj = {
    datetime: Date.now(),
    method: req.method,
    url: req.url,
    client: remoteIp,
    response_time: (time / 1e3),
    response_status: res.statusCode
  };
  if (parsing.isGetRequest(req)) {
    if (res.statusCode === 200) {
      obj.cache_hit = false;
    } else if (res.statusCode === 307) {
      obj.cache_hit = true;
    }
    try {
      const params = parsing.getImageParams(req);
      for (let param in params) {
        if (params.hasOwnProperty(param)) {
          obj[param] = params[param];
        }
      }
    } catch (e) {
      log.log('info', `Could not extract image parameters, might not have been an image request: ${req.url}`);
    }
  }
  log.log('debug', JSON.stringify(obj));
}

export default logRequest;
