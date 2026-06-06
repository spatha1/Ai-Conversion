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

    # ── Application DB (Azure SQL or SQL Server on VM) ───────
    DB_SERVER:   str = "localhost"
    DB_NAME:     str = "ConversionDB"
    DB_USER:     str = ""
    DB_PASSWORD: str = ""
    DB_DRIVER:   str = "ODBC Driver 17 for SQL Server"

    # ── Security ─────────────────────────────────────────────
    SECRET_KEY:     str = "change-me"
    ENCRYPTION_KEY: str = ""

    # ── Default admin user (seeded on first run) ─────────────
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "clarity2024"   # override in .env for production

    # ── API / CORS ────────────────────────────────────────────
    PORT: int = 8000
    APP_ENV: str = "development"          # development | production
    ALLOWED_ORIGINS: str = (
        "http://localhost,http://localhost:3000,"
        "http://127.0.0.1,http://127.0.0.1:3000,null"
    )

    # ── Azure OpenAI (preferred — overrides OPENAI_API_KEY) ──
    AZURE_OPENAI_ENDPOINT:        str = ""   # https://<name>.openai.azure.com/
    AZURE_OPENAI_API_KEY:         str = ""
    AZURE_OPENAI_API_VERSION:     str = "2024-08-01-preview"
    AZURE_OPENAI_DEPLOYMENT:      str = "gpt-4o-mini"          # chat deployment
    AZURE_OPENAI_EMB_DEPLOYMENT:  str = "text-embedding-3-small"  # embedding deployment

    # ── OpenAI (fallback when Azure OpenAI not configured) ───
    OPENAI_API_KEY: str = ""

    # ── Azure SQL Database (set SERVER to *.database.windows.net) ─
    # Uses the same DB_* keys above; Encrypt/TrustServerCertificate
    # are auto-detected from the server name.

    # ── Azure Blob Storage (global default) ──────────────────
    AZURE_STORAGE_CONN_STR:  str = ""    # DefaultEndpointsProtocol=https;...
    AZURE_STORAGE_CONTAINER: str = "conversion-output"

    # ── Azure File Share (Documents store) ───────────────────
    AZURE_FILES_CONN_STR:       str = ""   # same or separate storage account
    AZURE_FILES_SHARE_NAME:     str = "conversion-documents"
    AUTO_EXTRACT_ENABLED:       bool = False
    AUTO_EXTRACT_MAX_SIZE_MB:   int = 20

    # ── Default Snowflake ────────────────────────────────────
    SNOWFLAKE_ACCOUNT:    str = ""
    SNOWFLAKE_WAREHOUSE:  str = ""
    SNOWFLAKE_DATABASE:   str = ""
    SNOWFLAKE_SCHEMA:     str = "PUBLIC"
    SNOWFLAKE_ROLE:       str = ""
    SNOWFLAKE_USER:       str = ""
    SNOWFLAKE_PASSWORD:   str = ""
    SNOWFLAKE_PRIVATE_KEY_PATH:       str = ""
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: str = ""

    # ── Default MSSQL source ─────────────────────────────────
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

    # ── Report safety thresholds ─────────────────────────────
    REPORT_APPROVAL_THRESHOLD: int = 10000

    # ── Demo mode ─────────────────────────────────────────────
    DEMO_MODE: bool = False

    # ── Derived helpers ───────────────────────────────────────
    @cached_property
    def is_azure_sql(self) -> bool:
        """True when DB_SERVER points to Azure SQL Database (*.database.windows.net)."""
        return "database.windows.net" in self.DB_SERVER.lower()

    @cached_property
    def use_azure_openai(self) -> bool:
        """True when Azure OpenAI endpoint + key are both set."""
        return bool(
            self.AZURE_OPENAI_ENDPOINT.strip()
            and self.AZURE_OPENAI_API_KEY.strip()
        )

    @cached_property
    def openai_api_key(self) -> str:
        """Effective OpenAI key: Azure key if Azure is configured, else OPENAI_API_KEY."""
        return self.AZURE_OPENAI_API_KEY if self.use_azure_openai else self.OPENAI_API_KEY

    @cached_property
    def database_url(self) -> str:
        """
        SQLAlchemy connection URL for the conversion project DB.
        Auto-detects Azure SQL Database (*.database.windows.net) and switches to
        Encrypt=yes / TrustServerCertificate=no for the managed service cert.
        """
        from urllib.parse import quote_plus
        if self.is_azure_sql:
            encrypt = "yes"
            trust   = "no"
        else:
            encrypt = "no"
            trust   = "yes"
        odbc = (
            f"DRIVER={{{self.DB_DRIVER}}};"
            f"SERVER={self.DB_SERVER};"
            f"DATABASE={self.DB_NAME};"
            f"UID={self.DB_USER};"
            f"PWD={self.DB_PASSWORD};"
            f"TrustServerCertificate={trust};"
            f"Encrypt={encrypt};"
            f"Connection Timeout=30"
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
