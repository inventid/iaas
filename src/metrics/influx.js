import {InfluxDB} from 'influx';
import config from 'config';
import log from '../log';

function setup() {
  const influxConnection = config.get("metrics.influx.dsn");
  const influx = new InfluxDB(influxConnection);
  log('debug', `Connecting influx to ${influxConnection}`);

  let lastPrintedError;

  return {
    write(metric) {
      const metricPoint = metric.get();
      const influxMetric = {
        measurement: 'response_times',
        tags: Object.assign({}, metricPoint.tags, {request_type: metricPoint.type}),
        fields: Object.assign({}, metricPoint.fields, {duration: metricPoint.duration})
      };
      influx.writePoints([
        influxMetric
      ]).catch(err => {
        // limit an error to once every 30 seconds
        if (!lastPrintedError || (new Date() - lastPrintedError) > 30) {
          log('error', `Error saving data to InfluxDB! ${err.stack}`);
        }
        lastPrintedError = new Date();
      });
    }
  };
}

export default setup;
