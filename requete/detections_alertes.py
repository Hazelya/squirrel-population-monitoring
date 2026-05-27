
import os
from datetime import date
from supabase import PostgrestAPIError, create_client

from requete.connexion_bdd import supabase

def get_images():
    try:
        response = (
            supabase.table('detection')
            .select("id_detection", "image_path")
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_all_detections():
    try:
        response = (
            supabase.table('detection')
            .select("*")
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_one_detection(id: int):
    try:
        response = (
            supabase.table('detection')
            .select("*")
            .eq("id_detection", id)
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_all_alert():
    try:
        response = (
            supabase.table('alerte')
            .select("type_alerte", "date_alerte", "detection(image_path)")
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_one_alert(id: int):
    try:
        response = (
            supabase.table('alerte')
            .select("type_alerte", "date_alerte", "detection(image_path)")
            .eq("id_alerte", id)
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")

def get_one_alert_with_detection(id: int):
    try:
        response = (
            supabase.table('alerte')
            .select("type_alerte", "date_alerte", "detection(image_path)")
            .eq("detection_id", id)
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def set_alert(id: int, type_alerte: str, date_alerte: date, statut: str):
    try: 
        _ = (
            supabase.table("alerte")
            .insert({
                "type_alerte": type_alerte,
                "date_alerte": date_alerte,
                "statut": statut,
                "detection_id": id
            })
            .execute()
        )
        return

    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def set_disease(id: int, disease: bool):
    try:
        _ = (
            supabase.table("detection")
            .update({"malade": disease})
            .eq("id_detection", id)
            .execute()
        )
        return

    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")



def remove(id: str):
    try : 
        _ = (
            supabase.table("alerte")
            .delete()
            .eq("detection_id", id)
            .execute()
        )
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")
    
    try:
        _ = (
            supabase.table("detection")
            .delete()
            .eq("id_detection", id)
            .execute()
        )
        return
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")



def set_image(image_bytes, filename):

    image_path = None

    try:
        storage = create_client(
            os.environ.get("SUPABASE_URL"),
            os.environ.get("SUPABASE_SERVICE_KEY")
        )
        storage.storage.from_("photos-detection").upload(
            path=filename,
            file=image_bytes,
            file_options={
                "content-type": "image/jpeg",
                "upsert": "true"
            }
        )
        image_path = (
            storage.storage
            .from_("photos-detection")
            .get_public_url(filename)
        )

        # Insertion BDD
        supabase.table("detection").insert({
            "image_path": image_path
        }).execute()

        return image_path

    except PostgrestAPIError as error:

        print(f"Database error: {error.message}")

    except Exception as e:

        print(e)

    return None