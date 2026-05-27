from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from requete.detections_alertes import get_all_detections, get_images, get_one_detection, get_all_alert, get_one_alert, set_alert, set_disease, remove, set_image
from ia.squirrel_analyzer import run
import os, uuid, io
from datetime import date
from dotenv import load_dotenv
load_dotenv()
from PIL import Image as PILImage

app = Flask(__name__)
CORS(app)

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
    from requete.detections_alertes import get_one_alert_with_detection
    return jsonify(get_one_alert_with_detection(id))


@app.route('/remove/<int:id>', methods=['DELETE'])
def delete_detection(id):
    remove(id)
    return jsonify({"ok": True})



@app.route('/upload', methods=['POST'])
def upload_image():

    # Vérification fichier
    if 'image' not in request.files:
        return jsonify({
            'error': 'Aucune image reçue'
        }), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({
            'error': 'Fichier invalide'
        }), 400

    try:
        # Lire image
        img = PILImage.open(
            file.stream
        ).convert('RGB')

        # Conversion JPEG
        buffer = io.BytesIO()
        img.save(
            buffer,
            format='JPEG',
            quality=85
        )
        image_bytes = buffer.getvalue()
        filename = f"{uuid.uuid4().hex}.jpg"

        # Upload + DB
        image_path = set_image(
            image_bytes,
            filename
        )
        if image_path is None:
            return jsonify({
                'error': 'Erreur upload'
            }), 500
        return jsonify({
            'success': True,
            'image_path': image_path
        })

    except Exception as e:

        print(e)

        return jsonify({
            'error': str(e)
        }), 500
    

@app.route('/run-ia')
def run_ia():
    run()



if __name__ == '__main__':
    app.run(debug=True)