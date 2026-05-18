<?php

extension_loaded('pdo_pgsql') or die('The PDO PostgreSQL extension is not enabled.');
//require_once('../config.php');
$host = getenv('DB_HOST') ?: 'localhost';
$db = getenv('DB_NAME') ?: 'mydb';
$user = getenv('DB_USER') ?: 'root';
$pass = getenv('DB_PASS') ?: '';

class Db
{
    static $db = null;

    static function connectionDB()
    {
        if (self::$db != null) {
            return self::$db;
        }
        try {
            $db = new PDO('pgsql:host=' . DB_SERVER . ';port=' . DB_PORT . ';dbname=' . DB_NAME, DB_USER, DB_PASSWORD);
        } catch (PDOException $exception) {
            echo "in the catch";
            error_log('Connection error: ' . $exception->getMessage());
            echo 'Connection error: ' . $exception->getMessage();
            return false;
        }
        self::$db = $db;
        return $db;
    }
}
