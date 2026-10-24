"""Shared data contract. Everyone uses these names (agreed in Hour 0)."""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


class Doctor(BaseModel):
    id: Optional[int] = None
    name: str
    phone: Optional[str] = None  # only if refill alerts also go out as SMS


class Patient(BaseModel):
    id: Optional[int] = None
    name: str
    age: int
    doctor_id: int
    phone: str  # pill-time reminder texts
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


Role = Literal["patient", "family", "doctor"]


class Message(BaseModel):
    """Chat line. One chat per patient: the patient, their family and their doctor."""
    id: Optional[int] = None
    patient_id: int
    sender: Role
    sender_name: str
    text: str
    at: Optional[datetime] = None  # set by the backend


class PushToken(BaseModel):
    """Expo push token from the mobile app. user_id is the patient id for patient/family, doctor id for doctor."""
    role: Role
    user_id: int
    token: str


class Alert(BaseModel):
    id: Optional[int] = None
    type: Literal["missed", "low_pills", "expiring_soon"]
    to: Literal["doctor", "family"]
    patient_id: int
    message: str
    at: datetime
