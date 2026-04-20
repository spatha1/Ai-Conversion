# ═══════════════════════════════════════════════════════════
# config.py — reads .env via pydantic-settings
# ═══════════════════════════════════════════════════════════
import base64, hashlib
from functools import cached_property
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",          # ignore unknown keys in .env
    )

    # ── Conversion project DB (SQL Server) ──────────────────
    DB_SERVER: str = "localhost"
    DB_NAME:   str = "ConversionDB"
    DB_USER:   str = ""
    DB_PASSWORD: str = ""
    DB_DRIVER: str = "ODBC Driver 17 for SQL Server"

    # ── Security ─────────────────────────────────────────────
    SECRET_KEY:     str = "change-me"
    ENCRYPTION_KEY: str = ""

    # ── Default admin user (seeded on first run) ─────────────
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "clarity2024"   # override in .env for production

    # ── API ──────────────────────────────────────────────────
    PORT: int = 8000
    ALLOWED_ORIGINS: str = "http://localhost,http://127.0.0.1,null"

    # ── Default Snowflake (from .env, for quick-load) ────────
    SNOWFLAKE_ACCOUNT:    str = ""
    SNOWFLAKE_WAREHOUSE:  str = ""
    SNOWFLAKE_DATABASE:   str = ""
    SNOWFLAKE_SCHEMA:     str = "PUBLIC"
    SNOWFLAKE_ROLE:       str = ""
    SNOWFLAKE_USER:       str = ""
    SNOWFLAKE_PASSWORD:   str = ""
    SNOWFLAKE_PRIVATE_KEY_PATH:       str = ""
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: str = ""

    # ── Default MSSQL source (re-use project DB creds) ───────
    MSSQL_HOST:     str = ""
    MSSQL_PORT:     int = 1433
    MSSQL_DATABASE: str = ""
    MSSQL_SCHEMA:   str = "dbo"
    MSSQL_USERNAME: str = ""
    MSSQL_PASSWORD: str = ""

    # ── Target API defaults ──────────────────────────────────
    DEFAULT_TARGET_URL:    str = ""
    DEFAULT_TARGET_METHOD: str = "POST"
    DEFAULT_TARGET_TOKEN:  str = ""

    # ── OpenAI ───────────────────────────────────────────────
    OPENAI_API_KEY: str = ""

    @cached_property
    def database_url(self) -> str:
        """
        SQLAlchemy connection URL for the conversion project DB.
        Uses ODBC connection-string passthrough to handle special characters
        in passwords (e.g. '@') and named SQL Server instances (backslash).
        """
        from urllib.parse import quote_plus
        odbc = (
            f"DRIVER={{{self.DB_DRIVER}}};"
            f"SERVER={self.DB_SERVER};"
            f"DATABASE={self.DB_NAME};"
            f"UID={self.DB_USER};"
            f"PWD={self.DB_PASSWORD};"
            f"TrustServerCertificate=yes;"
            f"Encrypt=no"
        )
        return f"mssql+pyodbc:///?odbc_connect={quote_plus(odbc)}"

    @cached_property
    def fernet_key(self) -> bytes:
        """
        Return a valid 32-byte Fernet key.
        Uses ENCRYPTION_KEY if set, otherwise derives from SECRET_KEY.
        """
        raw = self.ENCRYPTION_KEY.strip()
        if raw:
            try:
                key_bytes = base64.urlsafe_b64decode(raw + "==")
                if len(key_bytes) == 32:
                    return base64.urlsafe_b64encode(key_bytes)
            except Exception:
                pass
        # Derive from SECRET_KEY
        digest = hashlib.sha256(self.SECRET_KEY.encode()).digest()
        return base64.urlsafe_b64encode(digest)

    @cached_property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
