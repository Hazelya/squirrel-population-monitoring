from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from requete.detections_alertes import get_all_detections, get_images, get_one_detection, get_all_alert, get_one_alert, set_alert, set_disease, remove
import os, uuid, io
from datetime import date
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
CORS(app)

# ─── CLIP (chargement paresseux) ─────────────────────────────────────────────

CLIP_AVAILABLE = False
try:
    import torch, clip as clip_lib
    CLIP_AVAILABLE = True
except ImportError:
    pass

_clip_model = None
_clip_preprocess = None
_text_features = None
_clip_device = 'cpu'

CLIP_LABELS = [
    ("a photo of a red squirrel",                    "Ecureuil roux"),
    ("a photo of a grey squirrel",                   "Ecureuil gris"),
    ("a photo of a Siberian chipmunk",               "Tamia de Sibérie"),
    ("a photo of a sick squirrel with skin lesions", "Individu malade"),
    ("a photo of an animal that is not a squirrel",  "Autre"),
]

def init_clip():
    global _clip_model, _clip_preprocess, _text_features, _clip_device
    if _clip_model is not None:
        return True
    if not CLIP_AVAILABLE:
        return False
    try:
        devices = ['cuda'] if torch.cuda.is_available() else ['cpu']
        for dev in devices + ['cpu']:
            try:
                _clip_device = dev
                _clip_model, _clip_preprocess = clip_lib.load("ViT-B/32", device=dev)
                texts = clip_lib.tokenize([l[0] for l in CLIP_LABELS]).to(dev)
                with torch.no_grad():
                    _text_features = _clip_model.encode_text(texts)
                    _text_features /= _text_features.norm(dim=-1, keepdim=True)
                return True
            except Exception:
                _clip_model = None
    except Exception:
        pass
    return False

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


@app.route('/remove/<int:id>')
def delete_detection(id):
    remove(id)
    return jsonify({"ok": True})


@app.route('/upload', methods=['POST'])
def upload_image():
    if 'image' not in request.files:
        return jsonify({'error': 'Aucune image reçue'}), 400
    file = request.files['image']
    if not file.filename:
        return jsonify({'error': 'Fichier invalide'}), 400

    if not init_clip():
        return jsonify({'error': 'CLIP non disponible. Installez : pip install torch torchvision && pip install git+https://github.com/openai/CLIP.git'}), 503

    from PIL import Image as PILImage

    # Lire l'image en mémoire
    file.seek(0)
    img = PILImage.open(file.stream).convert('RGB')

    # Convertir en JPEG bytes
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85)
    img_bytes = buf.getvalue()
    storage_filename = f"{uuid.uuid4().hex}.jpg"

    # Upload vers Supabase Storage avec la clé service_role
    image_path = None
    try:
        from supabase import create_client
        service_key = os.environ.get("SUPABASE_SERVICE_KEY")
        supabase_url = os.environ.get("SUPABASE_URL")
        storage_client = create_client(supabase_url, service_key)
        storage_client.storage.from_("photos-detection").upload(
            path=storage_filename,
            file=img_bytes,
            file_options={"content-type": "image/jpeg", "upsert": "true"}
        )
        image_path = storage_client.storage.from_("photos-detection").get_public_url(storage_filename)
        print(f"Storage OK: {image_path}")
    except Exception as e:
        print(f"Storage error, fallback local: {e}")
        uploads_dir = os.path.join(app.static_folder, 'uploads')
        os.makedirs(uploads_dir, exist_ok=True)
        filepath = os.path.join(uploads_dir, storage_filename)
        img.save(filepath)
        image_path = f"/static/uploads/{storage_filename}"

    # Classification CLIP
    img_tensor = _clip_preprocess(img).unsqueeze(0).to(_clip_device)
    with torch.no_grad():
        img_features = _clip_model.encode_image(img_tensor)
        img_features /= img_features.norm(dim=-1, keepdim=True)
        logit_scale = _clip_model.logit_scale.exp()
        similarities = (logit_scale * img_features @ _text_features.T).squeeze(0)
        probs = similarities.softmax(dim=0).cpu().numpy()

    results = sorted([
        {"species": CLIP_LABELS[i][1], "label": CLIP_LABELS[i][0], "confidence": round(float(probs[i]) * 100, 1)}
        for i in range(len(CLIP_LABELS))
    ], key=lambda x: x["confidence"], reverse=True)

    top = results[0]
    malade = top["species"] == "Individu malade"

    # Enregistrement en base
    saved = False
    detection_id = None
    db_error = None
    try:
        from requete.connexion_bdd import supabase as db
        resp = db.table('detection').insert({
            'image_path': image_path,
            'malade': malade,
            'clip_labels': results,
        }).select('id_detection').execute()

        if resp.data:
            saved = True
            detection_id = resp.data[0]['id_detection']
            if malade:
                set_alert(detection_id, "Individu malade", date.today().isoformat(), "nouveau")
    except Exception as e:
        db_error = str(e)
        print(f"DB error: {e}")

    return jsonify({
        'top': top,
        'all': results,
        'malade': malade,
        'image_path': image_path,
        'saved': saved,
        'detection_id': detection_id,
        'db_error': db_error,
    })


if __name__ == '__main__':
    app.run(debug=True)