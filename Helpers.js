import config from 'config';

import log from './Log';

const Helpers = {
  serverStatus(res, dbDone) {
    if (dbDone) {
      res.statuscode = 200;
      res.write('OK').end();
      log.log('info', 'healthcheck performed');
    } else {
      res.statusCode = 500;
      res.write('No database connection').end();
    }
  },
  robotsTxt(req, res) {
    res.writeHead(200, 'OK');
    if (config.has('allow_indexing') && config.get('allow_indexing')) {
      res.write("User-agent: *\nAllow: /"); //eslint-disable-line quotes
    } else {
      res.write("User-agent: *\nDisallow: /"); //eslint-disable-line quotes
    }
    res.end();
    log.log('info', 'robots.txt served');
  },
  allowCrossDomain(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'accept, content-type');
    res.setHeader('Access-Control-Allow-Method', 'GET');
    next();
  },
  send404(res, url) {
    log.log('warning', `404 Error for ${url}`);
    res.statusCode = 404;
    res.end();
  },
  send415(res, fileType) {
    log.log('warning', `Filetype ${fileType} is not supported`);
    res.statusCode = 415;
    res.end();
  },
  send307DueTooLarge(res, params) {
    res.statuscode = 307;
    res.setHeader('Location', `/${params.fileName}_${params.resolutionX}_${params.resolutionY}.${params.fileType}?fit=${params.fit}`);
    res.setHeader('X-Redirect-Info', 'The requested image size falls outside of the allowed boundaries of this service. We are directing you to the closest available match.'); //eslint-disable-line max-len
    res.end();
  },
  send307DueToCache(res, params, url) {
    log.log('info', `cache hit for ${params.fileName}.${params.fileType} (${params.resolutionX}x${params.resolutionY}px, fit: ${params.fit})`);  //eslint-disable-line max-len
    res.statusCode = 307;
    res.setHeader('Location', url);
    res.setHeader('Cache-Control', 'public');
    res.setHeader('Expires', Helpers.farFutureDate());
    res.end();
  },
  send403(res) {
    log.log('warn', 'Invalid or expired token used for upload');
    res.statusCode = 403;
    res.end();
  },
  send500(res, error) {
    log.log('error', error);
    res.statusCode = 500;
    res.end();
  },
  farFutureDate() {
    const cacheDate = new Date();
    cacheDate.setFullYear(cacheDate.getFullYear() + 10);
    return cacheDate;
  }
};

export default Helpers;
