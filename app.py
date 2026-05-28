from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from requete.detections_alertes import (
    get_all_detections, get_images, get_one_detection,
    get_all_alert, get_one_alert, set_alert,
    set_disease, remove, set_image, get_one_alert_with_detection
)
import os, uuid, io
from datetime import date
from dotenv import load_dotenv
from PIL import Image as PILImage
import requests

load_dotenv()

app = Flask(__name__)
CORS(app)

# =======================
# GITHUB ACTIONS CONFIG
# =======================
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

GITHUB_OWNER = "Hazelya"
GITHUB_REPO = "squirrel-population-monitoring"

WORKFLOW = "squirrel_analyzer.yml"

BRANCH = "main"


@app.route('/')
@app.route('/main-page')
def index():
    return render_template('main.html')


@app.route('/stats-page')
def stats():
    return render_template('stats.html')


@app.route('/photos-page')
def photos():
    return render_template('photos.html')


@app.route('/analyse-page/<int:id>')
def analyse(id):
    return render_template('analyse.html', detection_id=id)


@app.route('/alertes-page')
def alertes_page():
    return render_template('alertes.html')


@app.route('/projets-page')
def projet_page():
    return render_template('projet.html')


@app.route('/infos-page')
def infos_page():
    return render_template('infos.html')


@app.route('/detections')
def detections():
    return jsonify(get_all_detections())


@app.route('/detections/<int:id>')
def one_detection(id):
    return jsonify(get_one_detection(id))


@app.route('/alertes')
def alertes():
    return jsonify(get_all_alert())


@app.route('/alertes/<int:id>')
def one_alerte(id):
    return jsonify(get_one_alert(id))


@app.route('/detections/<int:id>/alertes')
def alertes_by_detection(id):
    return jsonify(get_one_alert_with_detection(id))


@app.route('/set-alerte/<int:id>/<string:type_alerte>/<string:date_alerte>/<string:statut>', methods=['POST'])
def set_detection(id, type_alerte, date_alerte, statut):
    set_alert(id, type_alerte, date_alerte, statut)
    return jsonify({"ok": True})


@app.route('/remove/<int:id>', methods=['DELETE'])
def delete_detection(id):
    remove(id)
    return jsonify({"ok": True})


@app.route('/upload', methods=['POST'])
def upload_image():

    if 'image' not in request.files:
        return jsonify({'error': 'Aucune image reçue'}), 400

    file = request.files['image']

    if file.filename == '':
        return jsonify({'error': 'Fichier invalide'}), 400

    try:
        img = PILImage.open(file.stream).convert('RGB')

        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=85)
        image_bytes = buffer.getvalue()

        filename = f"{uuid.uuid4().hex}.jpg"

        image_path = set_image(image_bytes, filename)

        if image_path is None:
            return jsonify({'error': 'Erreur upload'}), 500

        return jsonify({
            'success': True,
            'image_path': image_path
        })

    except Exception as e:
        print(e)
        return jsonify({'error': str(e)}), 500


# =======================
# TRIGGER GITHUB ACTIONS
# =======================
@app.route('/run-ia', methods=['POST'])
def run_ia():

    print("rentre")
    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/actions/workflows/{WORKFLOW}/dispatches"

    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json"
    }

    payload = {
        "ref": BRANCH
    }

    response = requests.post(url, headers=headers, json=payload)

    return jsonify({
        "success": response.status_code == 200 or response.status_code == 204,
        "status_code": response.status_code,
        "response": response.text
    })


@app.route('/workflow-status')
def workflow_status():

    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/actions/runs"

    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json"
    }

    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        return jsonify({"success": False}), 500

    runs = response.json()["workflow_runs"]

    if not runs:
        return jsonify({
            "success": True,
            "status": "unknown"
        })

    latest = runs[0]

    return jsonify({
        "success": True,
        "status": latest["status"],
        "conclusion": latest["conclusion"]
    })


if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)
