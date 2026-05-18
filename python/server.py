from flask import Flask, jsonify
import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

def get_db():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "mydb"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASS", "")
    )

@app.route('/api/data')
def get_data():
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users")
    return jsonify(cursor.fetchall())

if __name__ == '__main__':
    app.run(port=5000, debug=True)
