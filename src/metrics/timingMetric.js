import {VALID_TYPES} from './index';

function typeOrError(type) {
  if (VALID_TYPES.includes(type)) {
    return type;
  }
  throw new Error('invalid type for a metric supplied');
}

export default function newMetric(metricType, {fields, tags} = {
  fields: {},
  tags: {}
}, stop = undefined, start = undefined) {
  const type = typeOrError(metricType);
  const startTime = start || new Date();
  fields = Object.assign({}, fields);
  tags = Object.assign({}, tags);

  return {
    addFields(keyValues) {
      Object.entries(keyValues).forEach(([key, value]) => this.addField(key, value));
    },
    addTags(keyValues) {
      Object.entries(keyValues).forEach(([key, value]) => this.addTag(key, value));
    },
    addField(key, value) {
      fields[key] = value;
      return this;
    },
    addTag(key, value) {
      tags[key] = value;
      return this;
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
