import config from 'config';

const logLevels = {
  debug: config.has('log.debug') ? Boolean(config.get('log.debug')) : false,
  stats: config.has('log.stats') ? Boolean(config.get('log.stats')) : false,
  info: config.has('log.info') ? Boolean(config.get('log.info')) : true,
  warn: config.has('log.warn') ? Boolean(config.get('log.warn')) : true,
  error: config.has('log.error') ? Boolean(config.get('log.error')) : true
};

// Central logging. console.log can be replaced by writing to a logfile for example
export default function log(level, message) {
  if (logLevels[level] === undefined) {
    log('error', `Log level '${level}' was declared but not handled`);
    level = 'warn';
  }
  if (logLevels[level]) {
    const obj = {
      datetime: Date.now(),
      severity: level,
      message: message
    };
    console.log(JSON.stringify(obj));  //eslint-disable-line no-console
  }
};
