"use strict";

var log = require('./log.js');
var config = require('config');

module.exports = {
  serverStatus: function serverStatus(req, res) {
    res.writeHead(200, 'OK');
    res.write('OK');
    res.end();
    log.log('info', 'healthcheck performed');
  },
  robotsTxt: function robotsTxt(req, res) {
    res.writeHead(200, 'OK');
    if (config.has('allow_indexing') && config.get('allow_indexing')) {
      res.write("User-agent: *\nAllow: /");
    } else {
      res.write("User-agent: *\nDisallow: /");
    }
    res.end();
    log.log('info', 'robots.txt served');
  },
  allowCrossDomain: function allowCrossDomain(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "accept, content-type");
    res.header("Access-Control-Allow-Method", "GET");
    next();
  },
  send404: function send404(res, url) {
    log.log('warning', '404 Error for ' + url);
    res.writeHead(404, 'File not found');
    res.end();
  },
  send415: function send415(res, fileType) {
    log.log('warning', 'Filetype ' + fileType + ' is not supported');
    res.writeHead(415, 'Unsupported media type');
    res.end();
  },
  send307DueTooLarge: function send307DueTooLarge(res, params) {
    res.writeHead(307, {
      'Location': '/' + params.fileName + '_' + params.resolutionX + '_' + params.resolutionY + '.' + params.fileType + '?fit=' + params.fit,
      'X-Redirect-Info': 'The requested image size falls outside of the allowed boundaries of this service. We are directing you to the closest available match.'
    });
    res.end();
  },
  send307DueToCache: function send307DueToCache(res, params, url) {
    log.log('info', 'cache hit for ' + params.fileName + '.' + params.fileType + ' (' + params.resolutionX + 'x' + params.resolutionY + 'px, fit: ' + params.fit + ')');
    res.writeHead(307, { 'Location': url, 'Cache-Control': 'public' });
    res.end();
  },
  send403: function send403(res) {
    log.log('warn', 'Invalid or expired token used for upload');
    res.writeHead('403', 'Forbidden');
    res.end();
  },
  send500: function send500(res, error) {
    log.log('error', error);
    res.writeHead(500, 'Internal server error');
    res.end();
  }
};