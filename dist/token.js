"use strict";

var uuid = require('node-uuid');
var log = require('./log.js');

var insertToken = undefined;
var consumeToken = undefined;
var deleteOldTokens = undefined;
var db = undefined;

module.exports = {
  setDb: function setDb(database) {
    db = database;
    insertToken = db.prepare("INSERT INTO tokens (id, image_id, valid_until, used) VALUES (?,?,datetime('now','+15 minute'), 0)");
    consumeToken = db.prepare("UPDATE tokens SET used=1 WHERE id=? AND image_id=? AND valid_until>= datetime('now') AND used=0");
    deleteOldTokens = db.prepare("DELETE FROM tokens WHERE valid_until < datetime('now') AND used=0");
  },
  consume: function consume(token, id, callback) {
    consumeToken.run([token, id], callback);
  },
  create: function create(req, res) {
    // Here we create a token which is valid for one single upload
    // This way we can directly send the file here and just a small json payload to the app
    var newToken = uuid.v4();
    if (!req.body.id) {
      res.writeHead(400, 'Bad request');
      res.end();
      return;
    }
    // Ensure the id wasnt requested or used previously
    insertToken.run([newToken, req.body.id], function (err) {
      if (!err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        var responseObject = JSON.stringify({ token: newToken });
        res.write(responseObject);
        log.log('info', 'Created token successfully');
        if (module.exports.shouldRunCleanup()) {
          module.exports.cleanup();
        }
        res.end();
      } else {
        res.writeHead(403, 'Forbidden');
        res.write(JSON.stringify({ error: 'The requested image_id is already requested' }));
        res.end();
      }
    });
  },
  shouldRunCleanup: function shouldRunCleanup() {
    return Math.floor(Math.random() * 10) === 0;
  },
  cleanup: function cleanup() {
    log.log('info', 'Doing a token cleanup');
    deleteOldTokens.run([], function (err) {
      if (!err) {
        log.log('info', 'Cleaned ' + this.changes + ' tokens from the db');
      } else {
        log.log('error', 'Encountered error ' + err + ' when cleaning up tokens');
      }
    });
  }
};