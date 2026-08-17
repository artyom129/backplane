import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.core.errors import AppError


def _cipher() -> Fernet:
    digest = hashlib.sha256(settings.encryption_key.get_secret_value().encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_value(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    try:
        return _cipher().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise AppError(
            "decryption_failed",
            "The encrypted value could not be decrypted with the configured key.",
            500,
        ) from exc
