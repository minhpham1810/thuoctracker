"""Shared data contract. Everyone uses these names (agreed in Hour 0)."""
from datetime import date, datetime
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field

Role = Literal["patient", "family", "doctor"]
Slot = Literal[1, 2, 3, 4, 5, 6, 7]  # boxes 1-3 top row, 4-6 middle row, 7 the long bottom box
# validated here because one bad time string would crash the scheduler for every patient
HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class User(BaseModel):
    """One account = one role. Log in with email + password."""
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


class Signup(BaseModel):
    role: Role
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=6)
    age: Optional[int] = Field(None, ge=1, le=130)  # patient
    doctor_email: Optional[str] = None   # patient: their doctor's account
    patient_email: Optional[str] = None  # family: the patient's account


class Credentials(BaseModel):
    email: str
    password: str


class Session(BaseModel):
    token: str  # send as "Authorization: Bearer <token>"
    user: AnyUser


class Medicine(BaseModel):
    id: Optional[int] = None
    patient_id: int
    name: str = Field(min_length=1)
    dose: str  # e.g. "1 pill"
    times: list[HHMM] = Field(min_length=1)  # e.g. ["08:00", "20:00"]
    slot: Slot
    pills_left: int = Field(ge=0)
    expiration: date
    color: str  # shown on the cabinet screen


class MedicineUpdate(BaseModel):
    """PATCH body: only the fields that change (refill = pills_left)."""
    name: Optional[str] = Field(None, min_length=1)
    dose: Optional[str] = None
    times: Optional[list[HHMM]] = Field(None, min_length=1)
    slot: Optional[Slot] = None
    pills_left: Optional[int] = Field(None, ge=0)
    expiration: Optional[date] = None
    color: Optional[str] = None


class DoseLog(BaseModel):
    id: Optional[int] = None
    medicine_id: int
    due_at: datetime
    taken_at: Optional[datetime] = None  # None until taken
    status: Literal["pending", "taken", "missed"] = "pending"
    method: Optional[Literal["camera", "screen"]] = None


class Message(BaseModel):
    """1:1 chat line between two people in the same care circle."""
    id: Optional[int] = None
    from_id: Optional[int] = None  # set by the backend from the session
    to_id: int
    text: str
    at: Optional[datetime] = None  # set by the backend


class Contact(BaseModel):
    """Someone in my care circle, with our chat state."""
    user: AnyUser
    unread: int = 0  # their messages to me I haven't opened
    last: Optional[Message] = None


class LabelPhoto(BaseModel):
    """Label photo as base64 (JPEG or PNG, an optional "data:...;base64," prefix is fine). The phone app sends
    this instead of a multipart upload: SDK 58's fetch rejects React Native's file parts."""
    image: str = Field(min_length=1)


class Availability(BaseModel):
    """A doctor opens appointment times on one day: from start to end, one every `minutes`."""
    day: date
    start: HHMM
    end: HHMM
    minutes: Literal[15, 20, 30, 45, 60] = 30


class Appointment(BaseModel):
    """One appointment time. patient_id None = open for booking."""
    id: int
    doctor_id: int
    doctor_name: str
    starts_at: datetime
    minutes: int
    patient_id: Optional[int] = None
    patient_name: Optional[str] = None
    booked_by: Optional[int] = None
    reason: Optional[str] = None


class Booking(BaseModel):
    """patient_id: family books for their patient; a patient books for themself (default)."""
    patient_id: Optional[int] = None
    reason: Optional[str] = Field(None, max_length=300)


class PushToken(BaseModel):
    """Expo push token from the mobile app; stored on the caller's session."""
    token: str


class Alert(BaseModel):
    id: Optional[int] = None
    type: Literal["missed", "low_pills", "expiring_soon"]
    to: Literal["doctor", "family"]
    patient_id: int
    message: str
    at: datetime
