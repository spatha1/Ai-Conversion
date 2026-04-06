# ═══════════════════════════════════════════════════════════
# services/encryption.py — Fernet encrypt / decrypt helpers
# ═══════════════════════════════════════════════════════════
from cryptography.fernet import Fernet
from api.config import settings

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(settings.fernet_key)
    return _fernet


def encrypt(value: str | None) -> str | None:
    """Encrypt a plain-text string. Returns None if input is None/empty."""
    if not value:
        return None
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    """Decrypt a Fernet-encrypted string. Returns None if input is None/empty."""
    if not value:
        return None
    try:
        return _get_fernet().decrypt(value.encode()).decode()
    except Exception:
        return None
