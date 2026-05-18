<?php
define('DB_SERVER',   getenv('DB_HOST')     ?: 'localhost');
define('DB_PORT',     getenv('DB_PORT')     ?: '5432');
define('DB_NAME',     getenv('DB_NAME')     ?: 'mydb');
define('DB_USER',     getenv('DB_USER')     ?: 'postgres');
define('DB_PASSWORD', getenv('DB_PASSWORD') ?: '');
