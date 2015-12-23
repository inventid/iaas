// Central logging. console.log can be replaced by writing to a logfile for example
export default {
  log: function (level, message) {
    const obj = {
      datetime: Date.now(),
      severity: level,
      message: message
    };
    console.log(JSON.stringify(obj));
  }
};
