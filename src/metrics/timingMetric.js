import {VALID_TYPES} from './metrics';

function typeOrError(type) {
  if (VALID_TYPES.includes(type)) {
    return type;
  }
  throw new Error('invalid type for a metric supplied');
}

export default function newMetric(metricType, {fields, tags} = {fields: [], tags: []}, stop = undefined, start = undefined) {
  const type = typeOrError(metricType);
  const startTime = start || new Date();

  return {
    addField(key, value) {
      fields[key] = value;
    },
    addTag(key, value) {
      tags[key] = value;
    },
    get() {
      const duration = (stop || new Date()) - startTime;
      return {
        type,
        duration,
        tags,
        fields
      };
    },
    copy(newType) {
      return newMetric(newType, {fields, tags}, stop, startTime);
    },
    stop() {
      stop = new Date();
      return this.get();
    }
  };
}
