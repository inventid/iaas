// Central logging. console.log can be replaced by writing to a logfile for example
"use strict";

module.exports = {
  log: function log(level, message) {
    var obj = {
      datetime: Date.now(),
      severity: level,
      message: message
    };
    console.log(JSON.stringify(obj));
  }
};