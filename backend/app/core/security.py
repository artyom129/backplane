import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from app.config import settings
from app.core.errors import AppError

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    kdf = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1)
    digest = kdf.derive(password.encode())
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = encoded.split("$", 2)
        if algorithm != "scrypt":
            return False
        kdf = Scrypt(salt=bytes.fromhex(salt_hex), length=32, n=2**14, r=8, p=1)
        kdf.verify(password.encode(), bytes.fromhex(digest_hex))
        return True
    except (ValueError, TypeError):
        return False


def create_token(
    user_id: uuid.UUID,
    token_type: TokenType,
    expires_delta: timedelta,
) -> tuple[str, str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + expires_delta
    token_id = secrets.token_urlsafe(24)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "type": token_type,
        "jti": token_id,
        "iat": now,
        "exp": expires_at,
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return token, token_id, expires_at


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub", "jti", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise AppError("invalid_token", "The authentication token is invalid.", 401) from exc
    if payload.get("type") != expected_type:
        raise AppError("invalid_token", "The authentication token has the wrong type.", 401)
    return payload


def hash_credential(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_api_key() -> tuple[str, str, str]:
    raw = f"bp_live_{secrets.token_urlsafe(32)}"
    return raw, raw[:16], hash_credential(raw)


def constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode(), right.encode())
