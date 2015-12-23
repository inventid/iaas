import log from './Log';

export default {
  prepareDb(db, callback) {
    db.serialize(() => {
      log.log('info', "Creating the db schema");
      try {
        db.run("CREATE TABLE images (id VARCHAR(255), x INT(6), y INT(6), fit VARCHAR(8), file_type VARCHAR(8), url VARCHAR(255))");
        db.run("CREATE UNIQUE INDEX unique_image ON images(id,x,y,fit,file_type)");

        db.run("CREATE TABLE tokens ( id VARCHAR(255), image_id VARCHAR(255), valid_until TEXT, used INT(1))");
        db.run("CREATE UNIQUE INDEX unique_token ON tokens(id)");
        db.run("CREATE UNIQUE INDEX unique_image_request ON tokens(image_id)");
        db.run("CREATE INDEX token_date ON tokens(id, valid_until, used)");
        log.log('info', "Doing the callback from prepareDb");
        callback();
      } catch (e) {
        log.log('error', e);
      }
    });
  }
};
