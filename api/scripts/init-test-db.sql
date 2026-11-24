-- Runs once when the Docker volume is first created.
-- A separate database for tests, because the test suite drops and rebuilds its schema.
CREATE DATABASE splity_test OWNER splity;
