import http from 'http';
import https from 'https';
import fetch from 'node-fetch';
import log from "./log";

const httpAgent = new http.Agent({
  keepAlive: true
});
const httpsAgent = new https.Agent({
  keepAlive: true
});

const options = {
  agent: function (_parsedURL) {
    if (_parsedURL.protocol === 'http:') {
      return httpAgent;
    } else {
      return httpsAgent;
    }
  },
  // About 0.5MB of buffer size
  highWaterMark: 512 * 1024
};

export async function proxy(cacheUrl, response) {
  try {
    // Fetch from CDN and proxy itself
    const cacheResponse = await fetch(cacheUrl, options);
    Array.from(cacheResponse.headers.entries())
      .forEach(([header, headerValue]) => {
        response.set(header, headerValue);
      });
    response.status(cacheResponse.status);
    cacheResponse.body.pipe(response);
  } catch (e) {
    // Image not here apparently
    log('error', `Critical error while proxying image: ${e}`);
    response.status(500);
  }
}
