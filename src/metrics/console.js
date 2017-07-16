function setup() {
  return {
    write(metric) {
      console.log(metric.get()); //eslint-disable-line
    }
  };
}

const instance = setup();
export default instance;
