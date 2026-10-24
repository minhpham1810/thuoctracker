"""Tiger Data (Postgres) connection. DATABASE_URL comes from .env."""
import os

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

load_dotenv()

# check: Tiger Cloud drops idle connections; test each one before handing it out
pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=8,
                      kwargs={"autocommit": True, "row_factory": dict_row},
                      check=ConnectionPool.check_connection, open=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('patient', 'family', 'doctor')),
  age int,                                -- patient
  doctor_id int REFERENCES users(id),     -- patient: their doctor
  patient_id int REFERENCES users(id),    -- family: whose family
  CHECK (role <> 'patient' OR (age IS NOT NULL AND doctor_id IS NOT NULL)),
  CHECK (role <> 'family' OR patient_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
CREATE TABLE IF NOT EXISTS medicines (
  id serial PRIMARY KEY,
  patient_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, dose text NOT NULL, times text[] NOT NULL,
  slot int NOT NULL, pills_left int NOT NULL, expiration date NOT NULL, color text NOT NULL,
  UNIQUE (patient_id, slot)
);
CREATE TABLE IF NOT EXISTS doses (
  id serial PRIMARY KEY,
  medicine_id int NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  due_at timestamp NOT NULL, taken_at timestamp,
  status text NOT NULL DEFAULT 'pending', method text
);
CREATE TABLE IF NOT EXISTS alerts (
  id serial PRIMARY KEY, type text NOT NULL, "to" text NOT NULL,
  patient_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL, at timestamp NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id serial PRIMARY KEY,
  from_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL, at timestamp NOT NULL
);
-- no FK to users: /demo/reset truncates users but phones should stay registered
CREATE TABLE IF NOT EXISTS push_tokens (token text PRIMARY KEY, user_id int NOT NULL);
"""


def q(sql: str, *args) -> list[dict]:
    """Run one statement; rows as dicts (empty for statements with no result)."""
    with pool.connection() as c:
        cur = c.execute(sql, args or None)  # None: lets SCHEMA run several statements
        return cur.fetchall() if cur.description else []


def q1(sql: str, *args) -> dict | None:
    rows = q(sql, *args)
    return rows[0] if rows else None
