ALTER TABLE tokens DROP COLUMN valid_until;
ALTER TABLE tokens ADD COLUMN valid_until timestamp with time zone;