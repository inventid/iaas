import config from 'config';

import log from '../log';
import postgresql from './postgresql';

function databaseSetup() {
  if (config.has('postgresql')) {
    log('info', 'Setting up postgresql database');
    return postgresql();
  }
  throw new Error("No database configured");
}

const instance = databaseSetup();
export default instance;
