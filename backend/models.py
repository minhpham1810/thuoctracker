"""Shared data contract. Everyone uses these names (agreed in Hour 0)."""
from datetime import date, datetime
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field

Role = Literal["patient", "family", "doctor"]


class User(BaseModel):
    """One account = one role. Log in by email."""
    id: Optional[int] = None
    email: str
    name: str
    role: Role


class Doctor(User):
    role: Literal["doctor"] = "doctor"


class Patient(User):
    role: Literal["patient"] = "patient"
    age: int
    doctor_id: int


class Family(User):
    role: Literal["family"] = "family"
    patient_id: int  # whose family


AnyUser = Annotated[Union[Doctor, Patient, Family], Field(discriminator="role")]


class Medicine(BaseModel):
    id: Optional[int] = None
    patient_id: int
    name: str
    dose: str  # e.g. "1 pill"
    times: list[str]  # e.g. ["08:00", "20:00"]
    slot: Literal[1, 2, 3, 4, 5, 6, 7]  # boxes 1-3 top row, 4-6 middle row, 7 the long bottom box
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


class Message(BaseModel):
    """1:1 chat line between two people assigned to each other (see contacts in main.py)."""
    id: Optional[int] = None
    from_id: Optional[int] = None  # set by the backend from the URL
    to_id: int
    text: str
    at: Optional[datetime] = None  # set by the backend


class PushToken(BaseModel):
    """Expo push token from the mobile app."""
    user_id: int
    token: str


class Alert(BaseModel):
    id: Optional[int] = None
    type: Literal["missed", "low_pills", "expiring_soon"]
    to: Literal["doctor", "family"]
    patient_id: int
    message: str
    at: datetime
