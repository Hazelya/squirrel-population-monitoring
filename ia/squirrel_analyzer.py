# squirrel_analyzer.py
"""
Squirrel Species Analyzer

Flux :
    table detection
        ↓
    récupération image Supabase (camera-trap)
        ↓
    CLIP  →  y'a-t-il un écureuil ?
        ↓ oui
    EfficientNet  →  quelle espèce ?
        ↓
    YOLO  →  bounding box
        ↓
    upload image annotée dans photos-ia-detection
        ↓
    UPDATE detection(image_ia_path, clip_labels)

Installation :
    pip install torch torchvision transformers timm pillow supabase python-dotenv httpx ultralytics gdown

Variables d'environnement (.env) :
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_KEY=xxxxxxxx
    SUPABASE_SERVICE_KEY=xxxxxxxx
"""

import os
from io import BytesIO

import gdown
import httpx
import torch
import torch.nn as nn

from dotenv import load_dotenv
from supabase import create_client

from PIL import Image, ImageDraw, ImageFont
from torchvision import transforms
from transformers import CLIPProcessor, CLIPModel

import timm
from ultralytics import YOLO

# ─────────────────────────────────────────────────────────────
# ENV
# ─────────────────────────────────────────────────────────────

load_dotenv()

SUPABASE_URL         = os.getenv("SUPABASE_URL")
SUPABASE_KEY         = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

SOURCE_BUCKET = "camera-trap"
IA_BUCKET     = "photos-ia-detection"
TABLE         = "detection"

CLASSIFIER_PATH = "squirrel_classifier_v2.pth"
YOLO_PATH       = "yolo_squirrel.pt"

# ─────────────────────────────────────────────────────────────
# TÉLÉCHARGEMENT AUTOMATIQUE DES MODÈLES
# ─────────────────────────────────────────────────────────────

if not os.path.exists(CLASSIFIER_PATH):
    print("Téléchargement du modèle ConvNeXt depuis Google Drive...")
    gdown.download(
        "https://drive.google.com/uc?id=11Lx5IcBU4jzEtmZFjWhKrNSfmCakBM_n",
        CLASSIFIER_PATH,
        quiet=False
    )
    print("ConvNeXt téléchargé ✓")

if not os.path.exists(YOLO_PATH):
    print("Téléchargement du modèle YOLO depuis Google Drive...")
    gdown.download(
        "https://drive.google.com/uc?id=1VnGjmBfx0nHk2XMSHSIqNiYYKSklT2hw",
        YOLO_PATH,
        quiet=False
    )
    print("YOLO téléchargé ✓")

# ─────────────────────────────────────────────────────────────
# CLIENTS SUPABASE
# ─────────────────────────────────────────────────────────────

supabase         = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ─────────────────────────────────────────────────────────────
# DEVICE
# ─────────────────────────────────────────────────────────────

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"DEVICE : {DEVICE}")

# ─────────────────────────────────────────────────────────────
# CLIP  —  détection (y'a-t-il un écureuil ?)
# ─────────────────────────────────────────────────────────────

print("Chargement CLIP...")

clip_model     = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(DEVICE)
clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

CLIP_LABELS = [
    "a photo of a squirrel",
    "a photo of an empty forest",
    "a photo of another animal",
]
CLIP_THRESHOLD = 0.5

print("CLIP chargé")

# ─────────────────────────────────────────────────────────────
# EFFICIENTNET  —  classification d'espèce
# ─────────────────────────────────────────────────────────────

CLASS_NAMES = [
    "ecureuil_coree",   # index 0
    "ecureuil_gris",    # index 1
    "ecureuil_pallas",  # index 2
    "ecureuil_roux",    # index 3
]

CLASS_LABELS = {
    "ecureuil_coree":  "Écureuil de Corée",
    "ecureuil_gris":   "Écureuil gris",
    "ecureuil_pallas": "Écureuil de Pallas",
    "ecureuil_roux":   "Écureuil roux",
}

print("Chargement ConvNeXt...")

efficientnet = timm.create_model(
    "convnext_tiny",
    pretrained=False,
    num_classes=len(CLASS_NAMES)
)
efficientnet.load_state_dict(torch.load(CLASSIFIER_PATH, map_location=DEVICE))
efficientnet = efficientnet.to(DEVICE)
efficientnet.eval()

efficientnet_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406],
                         [0.229, 0.224, 0.225]),
])

print("ConvNeXt chargé")

# ─────────────────────────────────────────────────────────────
# YOLO  —  bounding box
# ─────────────────────────────────────────────────────────────

print("Chargement YOLO...")
yolo = YOLO(YOLO_PATH)
print("YOLO chargé")

# ─────────────────────────────────────────────────────────────
# FETCH DETECTIONS
# ─────────────────────────────────────────────────────────────

def fetch_pending_detections() -> list[dict]:
    """Récupère les détections non traitées (image_ia_path NULL)."""
    response = (
        supabase.table(TABLE)
        .select("id_detection, image_path")
        .is_("image_ia_path", "null")
        .execute()
    )
    return response.data

# ─────────────────────────────────────────────────────────────
# DOWNLOAD IMAGE
# ─────────────────────────────────────────────────────────────

def download_image(image_path: str) -> tuple[bytes, str]:
    """Télécharge une image — accepte une URL complète ou un chemin relatif."""
    if image_path.startswith("http"):
        url     = image_path
        headers = {}
    else:
        url     = f"{SUPABASE_URL}/storage/v1/object/{SOURCE_BUCKET}/{image_path}"
        headers = {
            "apikey":        SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }

    response = httpx.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    mime_type = response.headers.get("content-type", "image/jpeg").split(";")[0]
    return response.content, mime_type

# ─────────────────────────────────────────────────────────────
# ÉTAPE 1 — CLIP : y'a-t-il un écureuil ?
# ─────────────────────────────────────────────────────────────

def has_squirrel(image_bytes: bytes) -> tuple[bool, float]:
    """Retourne (True/False, score de confiance)."""
    image  = Image.open(BytesIO(image_bytes)).convert("RGB")
    inputs = clip_processor(
        text=CLIP_LABELS,
        images=image,
        return_tensors="pt",
        padding=True,
    ).to(DEVICE)

    with torch.no_grad():
        probs = clip_model(**inputs).logits_per_image.softmax(dim=1)[0]

    squirrel_score = probs[0].item()
    return squirrel_score >= CLIP_THRESHOLD, round(squirrel_score * 100, 2)

# ─────────────────────────────────────────────────────────────
# ÉTAPE 2 — EFFICIENTNET : quelle espèce ?
# ─────────────────────────────────────────────────────────────

def classify_species(image_bytes: bytes) -> list[dict]:
    """Retourne les espèces triées par confiance décroissante."""
    image  = Image.open(BytesIO(image_bytes)).convert("RGB")
    tensor = efficientnet_transform(image).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        probs = torch.softmax(efficientnet(tensor), dim=1)[0]

    results = [
        {
            "species":    CLASS_LABELS[cls],
            "confidence": round(prob.item() * 100, 2),
        }
        for cls, prob in zip(CLASS_NAMES, probs)
    ]

    results.sort(key=lambda x: x["confidence"], reverse=True)
    return results

# ─────────────────────────────────────────────────────────────
# ÉTAPE 3 — YOLO : bounding box
# ─────────────────────────────────────────────────────────────

def draw_detection_box(image_bytes: bytes, top_species: str, top_conf: float) -> bytes:
    """Détecte avec YOLO et annote l'image avec le label EfficientNet."""
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    draw  = ImageDraw.Draw(image)
    w, h  = image.size

    try:
        font = ImageFont.truetype("arial.ttf", max(14, h // 40))
    except Exception:
        font = ImageFont.load_default()

    yolo_results = yolo(image)[0]
    boxes_drawn  = 0

    for box in yolo_results.boxes:
        if float(box.conf[0]) < 0.4:
            continue
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        draw.rectangle([x1, y1, x2, y2], outline="red", width=3)
        label     = f"{top_species} {top_conf:.0f}%"
        bbox_text = draw.textbbox((x1, y1 - 20), label, font=font)
        draw.rectangle(bbox_text, fill="black")
        draw.text((x1, y1 - 20), label, fill="red", font=font)
        boxes_drawn += 1

    if boxes_drawn == 0:
        draw.rectangle([5, 5, w - 5, h - 5], outline="orange", width=3)
        label     = f"{top_species} {top_conf:.0f}%  [CLIP+EfficientNet]"
        bbox_text = draw.textbbox((10, 10), label, font=font)
        draw.rectangle(bbox_text, fill="black")
        draw.text((10, 10), label, fill="orange", font=font)

    output = BytesIO()
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()

# ─────────────────────────────────────────────────────────────
# UPLOAD IMAGE ANNOTÉE
# ─────────────────────────────────────────────────────────────

def push_image_to_ia_bucket(image_bytes: bytes, original_path: str) -> str:
    """Upload l'image annotée dans le bucket IA, retourne l'URL complète."""
    filename = os.path.splitext(original_path.split("/")[-1])[0] + ".jpg"
    ia_path  = f"analyzed/{filename}"

    supabase_service.storage.from_(IA_BUCKET).upload(
        path=ia_path,
        file=image_bytes,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )

    return f"{SUPABASE_URL}/storage/v1/object/public/{IA_BUCKET}/{ia_path}"

# ─────────────────────────────────────────────────────────────
# UPDATE DETECTION
# ─────────────────────────────────────────────────────────────

def update_detection(id_detection: str, ia_path: str, clip_labels: list) -> None:
    supabase.table(TABLE).update({
        "image_ia_path": ia_path,
        "clip_labels":   clip_labels,
    }).eq("id_detection", id_detection).execute()

# ─────────────────────────────────────────────────────────────
# PIPELINE COMPLET
# ─────────────────────────────────────────────────────────────

def process_detection(row: dict) -> None:
    id_det     = row["id_detection"]
    image_path = row["image_path"]

    print(f"\n{'─'*60}")
    print(f"id_detection : {id_det}")
    print(f"image_path   : {image_path}")

    # 1. Téléchargement
    print("Téléchargement image...")
    image_bytes, mime_type = download_image(image_path)
    print(f"{len(image_bytes) // 1024} Ko — {mime_type}")

    # 2. CLIP — filtre écureuil
    print("CLIP — détection écureuil...")
    detected, clip_score = has_squirrel(image_bytes)
    statut = "écureuil détecté" if detected else "pas d'écureuil"
    print(f"Score CLIP : {clip_score}% → {statut}")

    if not detected:
        print("Ignoré — pas d'écureuil sur la photo")
        update_detection(id_det, "no_squirrel", [])
        return

    # 3. EfficientNet — classification espèce
    print("ConvNeXt — classification espèce...")
    species_labels = classify_species(image_bytes)
    top = species_labels[0]
    print(f"Espèce : {top['species']} ({top['confidence']}%)")
    for s in species_labels[1:]:
        print(f"         {s['species']} ({s['confidence']}%)")

    # 4. YOLO — bounding box
    print("YOLO — bounding box...")
    annotated_bytes = draw_detection_box(image_bytes, top["species"], top["confidence"])

    # 5. Upload
    print(f"Upload dans '{IA_BUCKET}'...")
    ia_url = push_image_to_ia_bucket(annotated_bytes, image_path)
    print(f"URL : {ia_url}")

    # 6. Update BDD
    print("Update table detection...")
    update_detection(id_det, ia_url, species_labels)
    print("OK")

# ─────────────────────────────────────────────────────────────
# MAIN LOOP
# ─────────────────────────────────────────────────────────────

def run() -> None:
    print("Recherche des détections en attente...")
    rows = fetch_pending_detections()

    if not rows:
        print("Aucune détection en attente.")
        return

    print(f"{len(rows)} image(s) à traiter")

    for row in rows:
        try:
            process_detection(row)
        except Exception as e:
            print(f"Erreur sur {row.get('image_path')} : {e}")

# ─────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run()
