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
    Each ALTER is wrapped individually so one failure doesn't block the rest.
    """
    migrations = [
        # v1.3 — Snowflake private key passphrase
        ("dbo.conversion_source_connections", "sf_private_key_passphrase_enc", "NVARCHAR(MAX) NULL"),
        # v1.4 — conn_id linking for templates, mappings, formula rules
        ("dbo.conversion_xml_templates",      "conn_id",                       "INT NULL"),
        ("dbo.conversion_mappings",           "conn_id",                       "INT NULL"),
        ("dbo.conversion_mappings",           "identifier_column",             "NVARCHAR(255) NULL"),
        ("dbo.conversion_mappings",           "identifier_table",              "NVARCHAR(255) NULL"),
        # v1.5 — generated queries table (may already exist from create_all)
        # handled by create_all; nothing extra needed here
    ]
    with engine.connect() as conn:
        for table, column, definition in migrations:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD {column} {definition}"))
                conn.commit()
            except Exception:
                pass  # column already exists — skip
