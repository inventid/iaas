ALTER TABLE images ADD COLUMN quality INT NOT NULL DEFAULT -1;
DROP INDEX unique_image;

CREATE UNIQUE INDEX unique_image ON images(id,x,y,fit,file_type,blur,quality);
