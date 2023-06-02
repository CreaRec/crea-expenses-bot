# CREATE DATABASE expenses_bot_db;

CREATE TABLE event
(
    id       INT PRIMARY KEY AUTO_INCREMENT,
    amount   INTEGER     NOT NULL,
    category VARCHAR(50) NOT NULL,
    datetime DATETIME    NOT NULL
);