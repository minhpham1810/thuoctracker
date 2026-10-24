"""Twilio texts. Without credentials in .env, texts are printed instead so the demo still runs."""
import os

from twilio.rest import Client


def send_sms(to: str, body: str) -> bool:
    sid, token, sender = (os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
    if not (sid and token and sender and to):
        print(f"[sms skipped] to {to}: {body}")
        return False
    try:
        Client(sid, token).messages.create(to=to, from_=sender, body=body)
        return True
    except Exception as e:  # trial accounts reject unverified numbers; never crash the scheduler
        print(f"[sms failed] to {to}: {e}")
        return False
