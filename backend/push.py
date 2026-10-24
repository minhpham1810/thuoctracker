"""Phone push notifications through Expo's push service (the mobile app registers its token)."""
import requests

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_push(tokens: list[str], title: str, body: str, data: dict | None = None) -> bool:
    if not tokens:
        return False
    msgs = [{"to": t, "title": title, "body": body, "sound": "default", "data": data or {}} for t in tokens]
    try:
        r = requests.post(EXPO_PUSH_URL, json=msgs, timeout=5)
        r.raise_for_status()
        return True
    except requests.RequestException as e:  # no internet on the hotspot etc.; never crash the caller
        print(f"[push failed] {title}: {e}")
        return False
