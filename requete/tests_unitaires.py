import os
from flask import Flask
from supabase import PostgrestAPIError


from connexion_bdd import supabase
from detections_alertes import get_images, get_all_detections, get_one_detection, get_all_alert, get_one_alert, get_one_alert_with_detection, set_alert, set_disease, remove

app = Flask(__name__)


def test_images():
    print("GET images")
    results = get_images()
    print(results)

def test_all_detections():
    print("All Detections")
    results = get_all_detections()
    print(results)

def test_one_detection():
    print("One Detection")
    print(get_one_detection(5))

def test_all_alert():
    print("All Alertes")
    print(get_all_alert())

def test_one_alert():
    print("One Alerte")
    print(get_one_alert(1))

def test_one_alert_with_detection():
    print("One Alerte with detect")
    print(get_one_alert_with_detection(3))


def test_set_alert():
    print("Set Alerte")
    set_alert(2, "corée", "2026-05-18T11:02:00", "OK")
    print(get_all_alert())

def test_set_disease():
    print("SET Disease")
    set_disease(2, True)
    print(get_one_detection(2))
    set_disease(2, False)
    print(get_one_detection(2))

def test_remove():
    print("REMOVE")
    print(get_one_detection(6))
    print(get_one_alert_with_detection(6))
    remove(6)
    print(get_one_detection(6))
    print(get_one_alert_with_detection(6))


test_all_alert()