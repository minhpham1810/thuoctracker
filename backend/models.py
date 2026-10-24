"""Shared data contract. Everyone uses these names (agreed in Hour 0)."""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


class Doctor(BaseModel):
    id: Optional[int] = None
    name: str


class Patient(BaseModel):
    id: Optional[int] = None
    name: str
    age: int
    doctor_id: int
    family_phone: str


class Medicine(BaseModel):
    id: Optional[int] = None
    patient_id: int
    name: str
    dose: str  # e.g. "1 pill"
    times: list[str]  # e.g. ["08:00", "20:00"]
    slot: Literal[1, 2, 3]
    pills_left: int
    expiration: date
    color: str  # shown on the cabinet screen


class DoseLog(BaseModel):
    id: Optional[int] = None
    medicine_id: int
    due_at: datetime
    taken_at: Optional[datetime] = None  # None until taken
    status: Literal["pending", "taken", "missed"] = "pending"
    method: Optional[Literal["camera", "screen"]] = None


class Alert(BaseModel):
    id: Optional[int] = None
    type: Literal["missed", "low_pills", "expiring_soon"]
    to: Literal["doctor", "family"]
    patient_id: int
    message: str
    at: datetime
