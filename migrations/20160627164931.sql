ALTER TABLE images ADD COLUMN blur boolean DEFAULT 'f';
DROP INDEX unique_image;

CREATE UNIQUE INDEX unique_image ON images(id,x,y,fit,file_type,blur);