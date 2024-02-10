CREATE TABLE event
(
	id       SERIAL PRIMARY KEY,
	amount   INTEGER NOT NULL,
	category VARCHAR(50) NOT NULL,
	datetime TIMESTAMP NOT NULL,
	user_id VARCHAR(30),
	user_name VARCHAR(60)
);
