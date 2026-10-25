"""POST /login/auth0 without a real Auth0 login: Auth0's /userinfo reply is stubbed.
Adds one throwaway doctor to the database and deletes it.

Run: .venv/bin/python -m backend.test_auth0
"""
import os
import uuid

from fastapi import HTTPException

from . import main
from .db import q

os.environ.setdefault("AUTH0_DOMAIN", "example.auth0.com")
reply: dict = {}


class Userinfo:
    status_code = 200

    def json(self):
        return reply


main.requests.get = lambda *a, **kw: Userinfo()


def auth0_login(new_doctor=True, **info):
    """The user Auth0 login gives for this /userinfo reply, or the HTTP error code."""
    reply.clear()
    reply.update(info)
    try:
        return main.login_auth0("token", new_doctor).user
    except HTTPException as e:
        return e.status_code


email = f"auth0-{uuid.uuid4().hex[:6]}@demo.com"
try:
    assert auth0_login(False, email=email, email_verified=True) == 404  # the app never creates accounts
    assert auth0_login(email=email, email_verified=True).id == auth0_login(False, email=email, email_verified=True).id
    q("DELETE FROM users WHERE email = %s", email)
    u = auth0_login(email=email.upper(), name="Dr. Test", email_verified=False)
    assert (u.role, u.email, u.name) == ("doctor", email, "Dr. Test")  # new email: a new doctor account
    assert auth0_login(email=email, email_verified=False) == 401       # existing account, unverified: no takeover
    assert auth0_login(email=email, email_verified=True).id == u.id    # verified: logs into that account
    assert auth0_login(name="No email") == 400
finally:
    q("DELETE FROM users WHERE email = %s", email)  # its sessions go with it (ON DELETE CASCADE)
print("auth0 login OK")
