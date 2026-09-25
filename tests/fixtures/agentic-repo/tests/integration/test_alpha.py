from src.connectors.alpha import fetch_status


def test_fetch_status_returns_item():
    item = fetch_status("known-item")
    assert item["id"] == "known-item"
