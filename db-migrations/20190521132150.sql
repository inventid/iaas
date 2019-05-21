CREATE TABLE appchangelog ( name text NOT NULL, created_at timestamptz NOT NULL, completed_at timestamptz);
CREATE UNIQUE INDEX unique_name ON appchangelog(name);

INSERT INTO appchangelog (name, created_at) VALUES ('uploadedAt', NOW());
