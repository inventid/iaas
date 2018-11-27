import {InfluxDB} from 'influx';
import config from 'config';
import log from '../log';

const THRESHOLD_IN_MS = 60000;

function setup() {
  const influxConnection = config.get("metrics.influx.dsn");
  const influx = new InfluxDB(influxConnection);
  log('debug', `Connecting influx to ${influxConnection}`);

  let queue = [];
  let lastWrite = new Date();
  let lastPrintedError;
  let timeout;

  function drainQueue() {
    const queueToSend = queue;
    queue = [];
    lastWrite = new Date();
    if (queueToSend.length > 0) {
      log('info', `Draining queue for influx. Writing ${queueToSend.length} points.`);
      influx.writePoints(queueToSend).catch(err => {
        // limit an error to once every 30 seconds
        if (!lastPrintedError || (new Date() - lastPrintedError) > 30) {
          log('error', `Error saving data to InfluxDB! ${err.stack}`);
        }
        lastPrintedError = new Date();
      });
    }
  }

  process.on('SIGINT', drainQueue);
  process.on('SIGTERM', drainQueue);
  process.on('SIGQUIT', drainQueue);
  process.on('SIGABRT', drainQueue);

  return {
    write(metric) {
      const metricPoint = metric.get();
      const influxMetric = {
        measurement: 'response_times',
        tags: Object.assign({}, metricPoint.tags, {request_type: metricPoint.type}),
        fields: Object.assign({}, metricPoint.fields, {duration: metricPoint.duration}),
        timestamp: new Date(),
      };
      queue.push(influxMetric);

      // Now determine whether to actually fire a write (every 250 items or THRESHOLD_IN_MS)
      if (queue.length > 250 || new Date() - lastWrite > THRESHOLD_IN_MS) {
        drainQueue();
      } else {
        // For the case somebody receives little traffic
        const innerLast = lastWrite;
        timeout = setTimeout(() => {
          if (innerLast !== lastWrite) {
            log('debug', 'No need to write, another write was performed in the meantime');
            return;
          }
          drainQueue();
        }, THRESHOLD_IN_MS);
      }
    }
  };
}

export default setup;
