'use strict';

// This file should only run to craete the database and assumes no database is present
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('cache.db');

db.serialize(function () {
    db.run("CREATE TABLE images (id VARCHAR(255), x INT(6), y INT(6), file_type VARCHAR(8), url VARCHAR(255))");
    db.run("CREATE UNIQUE INDEX unique_image ON images(id,x,y,file_type)");

    db.run("CREATE TABLE tokens ( id VARCHAR(255), image_id VARCHAR(255), valid_until TEXT)");
    db.run("CREATE UNIQUE INDEX unique_token ON tokens(id)");
    db.run("CREATE INDEX token_date ON tokens(id, valid_until)");
});

db.close();
