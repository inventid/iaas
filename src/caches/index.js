import config from 'config';

import log from '../log';
import redis from './redis';

function cacheSetup() {
  if (config.has('redis')) {
    log('info', 'Setting up redis cache');
    return redis();
  }
  return null;
}

const instance = cacheSetup();
export default instance;
