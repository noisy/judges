import requests

BASE_URL = "https://gamma.example.com/api"


def fetch_status(item_id: str) -> dict:
    response = requests.get(f"{BASE_URL}/items/{item_id}", timeout=10)
    response.raise_for_status()
    return response.json()
