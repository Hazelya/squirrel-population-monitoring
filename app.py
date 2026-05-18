import os
from flask import Flask
from supabase import create_client, Client
from dotenv import load_dotenv

# Exemple
# Connexion base de données 
# requête simple
# Route HTML
# Affichage de la requête

load_dotenv()

app = Flask(__name__)

supabase: Client = create_client( # Connexion BDD
    os.environ.get("SUPABASE_URL"),
    os.environ.get("SUPABASE_KEY")
)

@app.route('/') # Route à l'origine
def index():
    response = supabase.table('detections').select("*").execute() # Requete
    todos = response.data # Résultat de la requete

    # HTML
    html = '<h1>TEST NUMERO 1</h1><ul>'
    for todo in todos:
        html += f'<li>{todo["id_detection"]}</li>'
    html += '</ul>'

    return html

if __name__ == '__main__': # Lancement du serveur (app.py) en local 
    app.run(debug=True)
