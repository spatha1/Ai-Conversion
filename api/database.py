# ═══════════════════════════════════════════════════════════
# database.py — SQLAlchemy engine + session factory
# Points to the conversion project DB (SQL Server / CLARITYAGENT)
# ═══════════════════════════════════════════════════════════
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from api.config import settings


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,          # reconnect on stale connections
    pool_size=5,
    max_overflow=10,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a DB session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables if they don't exist (called at startup)."""
    from api import models  # noqa: F401 — import so Base sees all models
    Base.metadata.create_all(bind=engine)
    _migrate()


def _migrate():
    """Add new columns to existing tables that pre-date them.
    Each statement runs in its own connection to avoid dirty transaction state
    after SQL Server errors (failed ALTER leaves the connection in aborted state).
    """
    migrations = [
        # v1.3 — Snowflake private key passphrase
        ("dbo.conversion_source_connections", "sf_private_key_passphrase_enc", "NVARCHAR(MAX) NULL"),
        # v1.4 — conn_id linking for templates, mappings, formula rules
        ("dbo.conversion_xml_templates",      "conn_id",                       "INT NULL"),
        ("dbo.conversion_mappings",           "conn_id",                       "INT NULL"),
        ("dbo.conversion_mappings",           "identifier_column",             "NVARCHAR(255) NULL"),
        ("dbo.conversion_mappings",           "identifier_table",              "NVARCHAR(255) NULL"),
    ]
    # Each ALTER gets its own connection so a failure never poisons the pool
    for table, column, definition in migrations:
        try:
            with engine.connect() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD {column} {definition}"))
                conn.commit()
        except Exception:
            pass  # column already exists — skip silently

    # ── Ensure new AI-platform tables exist (idempotent) ──────────────────────
    new_tables = [
        (
            "conversion_prompt_templates",
            """CREATE TABLE conversion_prompt_templates (
                id          INT IDENTITY(1,1) PRIMARY KEY,
                name        NVARCHAR(200)  NOT NULL UNIQUE,
                description NVARCHAR(500)  NULL,
                category    NVARCHAR(100)  NULL,
                content     NVARCHAR(MAX)  NOT NULL,
                is_active   BIT            NOT NULL DEFAULT 1,
                created_at  DATETIME2      DEFAULT GETUTCDATE(),
                updated_at  DATETIME2      DEFAULT GETUTCDATE()
            )""",
        ),
        (
            "conversion_ai_trace_log",
            """CREATE TABLE conversion_ai_trace_log (
                id            INT IDENTITY(1,1) PRIMARY KEY,
                module        NVARCHAR(50)   NOT NULL,
                conn_id       INT            NULL,
                model         NVARCHAR(100)  NOT NULL,
                prompt_text   NVARCHAR(MAX)  NULL,
                response_text NVARCHAR(MAX)  NULL,
                tokens_in     INT            NULL,
                tokens_out    INT            NULL,
                latency_ms    INT            NULL,
                created_at    DATETIME2      DEFAULT GETUTCDATE()
            )""",
        ),
        (
            "conversion_dev_artifacts",
            """CREATE TABLE conversion_dev_artifacts (
                id               INT IDENTITY(1,1) PRIMARY KEY,
                conn_id          INT            NULL,
                project_id       INT            NULL,
                task_description NVARCHAR(MAX)  NOT NULL,
                plan_json        NVARCHAR(MAX)  NULL,
                artifacts_json   NVARCHAR(MAX)  NULL,
                pipeline_config  NVARCHAR(MAX)  NULL,
                status           NVARCHAR(20)   NOT NULL DEFAULT 'draft',
                created_at       DATETIME2      DEFAULT GETUTCDATE(),
                updated_at       DATETIME2      DEFAULT GETUTCDATE()
            )""",
        ),
        (
            "conversion_external_integrations",
            """CREATE TABLE conversion_external_integrations (
                id          INT IDENTITY(1,1) PRIMARY KEY,
                type        NVARCHAR(20)   NOT NULL UNIQUE,
                base_url    NVARCHAR(500)  NOT NULL,
                username    NVARCHAR(200)  NULL,
                token_enc   NVARCHAR(MAX)  NULL,
                is_active   BIT            NOT NULL DEFAULT 1,
                created_at  DATETIME2      DEFAULT GETUTCDATE(),
                updated_at  DATETIME2      DEFAULT GETUTCDATE()
            )""",
        ),
    ]
    for table_name, ddl in new_tables:
        try:
            with engine.connect() as conn:
                exists = conn.execute(
                    text("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = :t"),
                    {"t": table_name},
                ).fetchone()
                if not exists:
                    conn.execute(text(ddl))
                    conn.commit()
        except Exception:
            pass  # table may already exist or DDL unsupported — skip
