"""AI functions. Pure in/out so each works alone; the backend wraps them in routes.

Each stub says what goes in and out. Gemini = vision, ElevenLabs = voice.
"""


def read_label(image: bytes) -> dict:
    """Label photo -> {name, dose, times, expiration}. Gemini."""
    raise NotImplementedError


def count_pills(image: bytes) -> int:
    """Slot photo -> number of pills visible. Gemini."""
    raise NotImplementedError


def transcribe(audio: bytes) -> str:
    """Question audio -> text. Speech to text."""
    raise NotImplementedError


def answer(question: str, dose_log: list[dict]) -> str:
    """Answer ONLY from the real dose log. Never advise or change a dose."""
    raise NotImplementedError


def speak(text: str) -> bytes:
    """Text -> MP3 bytes. ElevenLabs."""
    raise NotImplementedError
