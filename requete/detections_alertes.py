
import os
from datetime import date
from supabase import PostgrestAPIError

from connexion_bdd import supabase

def get_images():
    try:
        response = (
            supabase.table('detections')
            .select("id_detection", "image_path")
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_all_detections():
    try:
        response = (
            supabase.table('detections')
            .select("*")
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_one_detection(id: int):
    try:
        response = (
            supabase.table('detections')
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
            supabase.table('alertes')
            .select("type_alerte", "date_alerte", "detections(image_path)")
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def get_one_alert(id: int):
    try:
        response = (
            supabase.table('alertes')
            .select("type_alerte", "date_alerte", "detections(image_path)")
            .eq("id_alerte", id)
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")

def get_one_alert_with_detection(id: int):
    try:
        response = (
            supabase.table('alertes')
            .select("type_alerte", "date_alerte", "detections(image_path)")
            .eq("detection_id", id)
            .execute()
        )
        return response.data
    
    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def set_alert(id: int, type_alerte: str, date_alerte: date, statut: str):
    try: 
        _ = (
            supabase.table("alertes")
            .insert({
                "type_alerte": type_alerte,
                "date_alerte": date_alerte,
                "statut": statut,
                "detection_id": id
            })
            .execute()
        )

    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")


def set_disease(id: int, disease: bool):
    try:
        _ = (
            supabase.table("detections")
            .update({"malade": disease})
            .eq("id_detection", id)
            .execute()
        )

    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")

    """
    Possibilité d'un return pour créer un pop up 
    response = (
        supabase.table("instruments")
        .update({"name": "piano"})
        .eq("id", 1)
        .select("id, name")
        .execute()
    )
    """

def remove(id: str):
    try : 
        _ = (
            supabase.table("alertes")
            .delete()
            .eq("detection_id", id)
            .execute()
        )

    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")
    
    try:
        _ = (
            supabase.table("detections")
            .delete()
            .eq("id_detection", id)
            .execute()
        )

    except PostgrestAPIError as error:
        print(f"Database error: {error.message}")

