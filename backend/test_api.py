"""End-to-end check against a running backend. RESETS the demo data before and after.

Run: .venv/bin/python -m backend.test_api        (BACKEND_URL defaults to http://localhost:8000)
"""
import os
import uuid

import requests

B = os.environ.get("BACKEND_URL", "http://localhost:8000")
PW = "demo1234"


def call(method, path, token=None, expect=200, **kw):
    r = requests.request(method, B + path, headers={"Authorization": f"Bearer {token}"} if token else {}, timeout=20, **kw)
    assert r.status_code == expect, f"{method} {path}: {r.status_code} {r.text} (wanted {expect})"
    return r.json()


def login(email, expect=200, pw=PW):
    return call("POST", "/login", json={"email": email, "password": pw}, expect=expect)


call("POST", "/demo/reset")
login("doctor@demo.com", 401, pw="wrong")
doc, fam, lan = (login(e)["token"] for e in ("Doctor@Demo.com", "minh@demo.com", "lan@demo.com"))
call("GET", "/contacts", expect=401)

# circles
ids = lambda token: sorted(c["user"]["id"] for c in call("GET", "/contacts", token))
assert ids(doc) == [1, 2, 3, 5, 6] and ids(fam) == [1, 4] and ids(lan) == [4, 5]
assert "password_hash" not in str(call("GET", "/contacts", doc))

# chat: circle only, unread clears when the chat is opened
call("POST", "/messages", fam, 403, json={"to_id": 2, "text": "hi"})
call("POST", "/messages", fam, json={"to_id": 4, "text": "Grandma is dizzy"})
unread = lambda: next(c for c in call("GET", "/contacts", doc) if c["user"]["id"] == 5)
assert unread()["unread"] == 1 and unread()["last"]["text"] == "Grandma is dizzy"
assert call("GET", "/messages?with_id=5", doc)[-1]["text"] == "Grandma is dizzy"
assert unread()["unread"] == 0

# patient data: care circle only; medicine changes: doctor only, validated
call("GET", "/patients/2/medicines", fam, 403)
assert len(call("GET", "/patients/1/medicines", fam)) == 2
call("PATCH", "/medicines/2", fam, 403, json={"pills_left": 30})
assert call("PATCH", "/medicines/2", doc, json={"pills_left": 30})["pills_left"] == 30
call("PATCH", "/medicines/2", doc, 422, json={"times": ["8am"]})
call("PATCH", "/medicines/2", doc, 409, json={"slot": 1})
new = call("POST", "/medicines", doc, json={"patient_id": 1, "name": "Vitamin D", "dose": "1 pill", "times": ["09:00"],
                                             "slot": 3, "pills_left": 10, "expiration": "2030-01-01", "color": "yellow"})
call("DELETE", f"/medicines/{new['id']}", doc)
assert len(call("GET", "/patients/1/medicines", doc)) == 2
assert [a["to"] for a in call("GET", "/alerts", fam)] == ["family"] * len(call("GET", "/alerts", fam))
assert call("GET", "/alerts", lan) == []

# sign-up links by email
call("POST", "/signup", expect=400, json={"role": "patient", "name": "X", "email": "x@x.com", "password": PW,
                                          "age": 70, "doctor_email": "nobody@x.com"})
call("POST", "/signup", expect=409, json={"role": "doctor", "name": "X", "email": "MINH@demo.com", "password": PW})
email = f"kid-{uuid.uuid4().hex[:6]}@demo.com"
kid = call("POST", "/signup", json={"role": "family", "name": "Kim (granddaughter)", "email": email,
                                    "password": PW, "patient_email": "lan@demo.com"})
assert kid["user"]["patient_id"] == 1 and kid["user"]["id"] in ids(doc)

# "I took it": the patient's phone, or the cabinet screen without login
dose = call("POST", "/demo/pill_time?medicine_id=1")
call("POST", f"/doses/{dose['id']}/taken", fam, 403)
assert call("POST", f"/doses/{dose['id']}/taken", lan)["status"] == "taken"
call("POST", f"/cabinet/1/taken?dose_id={dose['id']}")
assert call("GET", "/cabinet/1/state")["mode"] == "already_took"
assert call("GET", "/cabinet/1/today")["name"] == "Grandma Lan"
call("POST", f"/cabinet/2/taken?dose_id={dose['id']}", expect=404)

call("POST", "/logout", fam)
call("GET", "/me", fam, 401)
call("POST", "/demo/reset")
print("backend OK")
