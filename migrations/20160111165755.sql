CREATE TABLE images (id VARCHAR(255), x INT, y INT, fit VARCHAR(8), file_type VARCHAR(8), url VARCHAR(255));
CREATE UNIQUE INDEX unique_image ON images(id,x,y,fit,file_type);

CREATE TABLE tokens ( id VARCHAR(255), image_id VARCHAR(255), valid_until TEXT, used INT);
CREATE UNIQUE INDEX unique_token ON tokens(id);
CREATE UNIQUE INDEX unique_image_request ON tokens(image_id);
CREATE INDEX token_date ON tokens(id, valid_until, used);