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
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamp;
-- one row per logged-in device; push_token here so logging out stops that phone's pushes
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token text,
  created_at timestamp NOT NULL
);
DROP TABLE IF EXISTS push_tokens;
-- Several backends can run against this database at once, so the "right now" state lives here too:
-- Pi commands, what the cabinet screen shows, photo counts, alerts already sent, reminder times.
CREATE TABLE IF NOT EXISTS cabinet_commands (
  id serial PRIMARY KEY,
  patient_id int NOT NULL,
  dose_id int,
  opens_door boolean NOT NULL DEFAULT false,
  cmd jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS cabinet_state (patient_id int PRIMARY KEY, state jsonb NOT NULL);
-- the last voice answer per cabinet, so the screen can show what the cabinet just said
CREATE TABLE IF NOT EXISTS cabinet_answer (patient_id int PRIMARY KEY, text text NOT NULL, at timestamp NOT NULL);
CREATE TABLE IF NOT EXISTS photo_counts (
  dose_id int NOT NULL, phase text NOT NULL, count int,
  PRIMARY KEY (dose_id, phase)
);
CREATE TABLE IF NOT EXISTS alerts_sent (kind text NOT NULL, medicine_id int NOT NULL, PRIMARY KEY (kind, medicine_id));
ALTER TABLE doses ADD COLUMN IF NOT EXISTS reminded_at timestamp;
-- one row: the backend that runs the scheduler. Another takes over when the heartbeat goes stale.
CREATE TABLE IF NOT EXISTS scheduler_lease (
  id int PRIMARY KEY CHECK (id = 1),
  holder text NOT NULL,
  heartbeat timestamptz NOT NULL,  -- the database's clock, so laptop clocks don't matter
  last_tick timestamp NOT NULL
);
-- appointments: a doctor's open times. Booking fills patient_id with one conditional UPDATE, so two people
-- tapping the same time (even through different backends) can't both get it.
CREATE TABLE IF NOT EXISTS appointment_slots (
  id serial PRIMARY KEY,
  doctor_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamp NOT NULL,
  minutes int NOT NULL,
  patient_id int REFERENCES users(id) ON DELETE SET NULL,  -- null = open
  booked_by int REFERENCES users(id) ON DELETE SET NULL,   -- the patient, or family booking for them
  reason text,
  booked_at timestamp,
  reminded_at timestamp,                                   -- the one-hour-before push went out
  UNIQUE (doctor_id, starts_at)
);
-- one dose per medicine per pill time, even if two schedulers overlap for a moment
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS doses_one_per_time ON doses (medicine_id, due_at);
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'duplicate doses already exist, doses_one_per_time not created';
END $$;
"""


def q(sql: str, *args) -> list[dict]:
    """Run one statement; rows as dicts (empty for statements with no result)."""
    with pool.connection() as c:
        cur = c.execute(sql, args or None)  # None: lets SCHEMA run several statements
        return cur.fetchall() if cur.description else []


def q1(sql: str, *args) -> dict | None:
    rows = q(sql, *args)
    return rows[0] if rows else None
