import uuid from 'node-uuid';

import log from './Log';

let insertToken;
let consumeToken;
let deleteOldTokens;

const Token = {
  setDb(database) {
    insertToken = database.prepare("INSERT INTO tokens (id, image_id, valid_until, used) VALUES (?,?,datetime('now','+15 minute'), 0)");
    consumeToken = database.prepare("UPDATE tokens SET used=1 WHERE id=? AND image_id=? AND valid_until>= datetime('now') AND used=0");
    deleteOldTokens = database.prepare("DELETE FROM tokens WHERE valid_until < datetime('now') AND used=0");

  },
  // This method is madness, but node-sqlite3 binds the this, so #noLambda
  consume(token, id, callback) {
    consumeToken.run([token, id], function(err) {
      callback(err, this);
    });
  },
  create(req, res) {
    // Here we create a token which is valid for one single upload
    // This way we can directly send the file here and just a small json payload to the app
    const newToken = uuid.v4();
    if (!req.body.id) {
      res.writeHead(400, 'Bad request');
      console.log(req.body);
      return res.end();
    }
    // Ensure the id wasnt requested or used previously
    insertToken.run([newToken, req.body.id], (err) => {
      if (!err) {
        res.json({token: newToken}).end();
        log.log('info', 'Created token successfully');
        if (Token.shouldRunCleanup()) {
          Token.cleanup();
        }
        res.end();
      } else {
        return res.writeHead(403, 'Forbidden').json({error: 'The requested image_id is already requested'}).end();
      }
    });
  },
  shouldRunCleanup() {
    return Math.floor(Math.random() * 10) === 0;
  },
  cleanup() {
    log.log('info', 'Doing a token cleanup');
    deleteOldTokens.run([], (err) => {
      if (!err) {
        log.log('info', `Cleaned ${this.changes} tokens from the db`);
      } else {
        log.log('error', `Encountered error ${err} when cleaning up tokens`);
      }
    });
  }
};

export default Token;
