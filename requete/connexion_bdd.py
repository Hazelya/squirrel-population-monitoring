import os
from supabase import create_client, Client, AuthApiError, AuthInvalidCredentialsError
from dotenv import load_dotenv

load_dotenv()


try :
    supabase: Client = create_client( # Connexion BDD
        os.environ.get("SUPABASE_URL"),
        os.environ.get("SUPABASE_KEY")
    )

except AuthApiError as error:
    # Handle authentication API errors
    print(f"Auth error: {error.message}")
    
except AuthInvalidCredentialsError:
    # Handle specific case of invalid credentials
    print("Invalid credentials provided")

