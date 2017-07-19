function setup() {
  return {
    write(metric) {
      console.log(metric.get()); //eslint-disable-line
    }
  };
}

export default setup;
