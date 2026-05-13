#!/usr/bin/env python3
"""
migrate_to_azure.py
Migrates ConversionAgent and LegacyData from local SQLEXPRESS to Azure VM SQL Server 2022.

Usage:
    python migrate_to_azure.py                          # migrate both DBs + update .env
    python migrate_to_azure.py --db ConversionAgent     # one DB only
    python migrate_to_azure.py --db LegacyData
    python migrate_to_azure.py --skip-data              # schema only, no data copy
    python migrate_to_azure.py --no-update-env          # skip .env update
"""

import pyodbc
import argparse
import sys
import re

# Force UTF-8 output on Windows so progress symbols print correctly
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from pathlib import Path
from datetime import datetime

# ── Source ───────────────────────────────────────────────────────────────────
SRC_SERVER = r"DESKTOP-G01PH8C\SQLEXPRESS"
SRC_DRIVER = "ODBC Driver 17 for SQL Server"

# ── Target (Azure VM SQL Server 2022 Docker) ──────────────────────────────────
TGT_SERVER = "104.211.112.63,1433"
TGT_USER   = "sa"
TGT_PASS   = "Clarity@2026"
TGT_DRIVER = "ODBC Driver 17 for SQL Server"

# App user to create on target
APP_USER = "clarityAgentuser"
APP_PASS = "AshuAdvi@2816"

BATCH_SIZE = 200

# ── Connection helpers ────────────────────────────────────────────────────────

def src_conn(db="master"):
    cs = (
        f"DRIVER={{{SRC_DRIVER}}};"
        f"SERVER={SRC_SERVER};"
        f"DATABASE={db};"
        "Trusted_Connection=yes;"
    )
    return pyodbc.connect(cs, autocommit=True)


def tgt_conn(db="master"):
    cs = (
        f"DRIVER={{{TGT_DRIVER}}};"
        f"SERVER={TGT_SERVER};"
        f"UID={TGT_USER};"
        f"PWD={TGT_PASS};"
        f"DATABASE={db};"
        "TrustServerCertificate=yes;"
        "Encrypt=yes;"
    )
    return pyodbc.connect(cs, autocommit=True)


# ── Schema helpers ────────────────────────────────────────────────────────────

def db_exists(conn, name: str) -> bool:
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM sys.databases WHERE name = ?", name)
    return cur.fetchone() is not None


def create_database(conn, name: str):
    conn.cursor().execute(f"CREATE DATABASE [{name}]")
    print(f"  [OK] Created database [{name}]")


def get_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    """)
    return [(r[0], r[1]) for r in cur.fetchall()]


def build_type_str(dtype, char_len, num_prec, num_scale, dt_prec) -> str:
    if dtype in ("varchar", "nvarchar", "char", "nchar", "binary", "varbinary"):
        if char_len == -1:
            return f"{dtype}(MAX)"
        return f"{dtype}({char_len})" if char_len else dtype
    if dtype in ("decimal", "numeric"):
        return f"{dtype}({num_prec},{num_scale})"
    if dtype in ("datetime2", "time", "datetimeoffset") and dt_prec is not None:
        return f"{dtype}({dt_prec})"
    if dtype == "float" and num_prec:
        return f"float({num_prec})"
    return dtype


def get_table_ddl(conn, schema: str, table: str):
    """Return (CREATE TABLE sql, has_identity bool)."""
    cur = conn.cursor()

    cur.execute("""
        SELECT
            c.COLUMN_NAME,
            c.DATA_TYPE,
            c.CHARACTER_MAXIMUM_LENGTH,
            c.NUMERIC_PRECISION,
            c.NUMERIC_SCALE,
            c.IS_NULLABLE,
            c.COLUMN_DEFAULT,
            COLUMNPROPERTY(
                OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)),
                c.COLUMN_NAME, 'IsIdentity'
            ) AS is_identity,
            c.DATETIME_PRECISION
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
        ORDER BY c.ORDINAL_POSITION
    """, schema, table)
    cols = cur.fetchall()

    cur.execute("""
        SELECT kcu.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
            ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
           AND tc.TABLE_SCHEMA   = kcu.TABLE_SCHEMA
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          AND tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
        ORDER BY kcu.ORDINAL_POSITION
    """, schema, table)
    pk_cols = [r[0] for r in cur.fetchall()]

    lines = []
    has_identity = False

    for col_name, dtype, char_len, num_prec, num_scale, nullable, default, is_ident, dt_prec in cols:
        type_str   = build_type_str(dtype, char_len, num_prec, num_scale, dt_prec)
        id_str     = " IDENTITY(1,1)" if is_ident else ""
        null_str   = " NOT NULL" if nullable == "NO" else " NULL"
        default_str = f" DEFAULT {default}" if default and not is_ident else ""
        if is_ident:
            has_identity = True
        lines.append(f"    [{col_name}] {type_str}{id_str}{null_str}{default_str}")

    if pk_cols:
        pk_list = ", ".join(f"[{c}]" for c in pk_cols)
        lines.append(f"    CONSTRAINT [PK_{table}] PRIMARY KEY CLUSTERED ({pk_list})")

    ddl = f"CREATE TABLE [{schema}].[{table}] (\n" + ",\n".join(lines) + "\n)"
    return ddl, has_identity


def table_exists(conn, schema: str, table: str) -> bool:
    cur = conn.cursor()
    cur.execute("""
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    """, schema, table)
    return cur.fetchone() is not None


# ── Data copy ─────────────────────────────────────────────────────────────────

def copy_table_data(src, tgt, schema: str, table: str, has_identity: bool):
    src_cur = src.cursor()
    tgt_cur = tgt.cursor()

    src_cur.execute(f"SELECT COUNT(*) FROM [{schema}].[{table}]")
    total = src_cur.fetchone()[0]
    if total == 0:
        print(f"      {schema}.{table}: 0 rows (skip)")
        return

    src_cur.execute(f"SELECT TOP 0 * FROM [{schema}].[{table}]")
    col_names = [d[0] for d in src_cur.description]
    placeholders = ", ".join("?" for _ in col_names)
    col_list  = ", ".join(f"[{c}]" for c in col_names)
    insert_sql = f"INSERT INTO [{schema}].[{table}] ({col_list}) VALUES ({placeholders})"

    if has_identity:
        tgt_cur.execute(f"SET IDENTITY_INSERT [{schema}].[{table}] ON")

    src_cur.execute(f"SELECT * FROM [{schema}].[{table}]")
    copied = 0
    errors = 0

    while True:
        rows = src_cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        batch = [tuple(r) for r in rows]
        try:
            tgt_cur.executemany(insert_sql, batch)
            copied += len(batch)
        except Exception:
            # Fall back to row-by-row for this batch
            for row in batch:
                try:
                    tgt_cur.execute(insert_sql, row)
                    copied += 1
                except Exception as row_err:
                    errors += 1
                    if errors <= 3:
                        print(f"      [row-err] {schema}.{table}: {row_err}")

    if has_identity:
        tgt_cur.execute(f"SET IDENTITY_INSERT [{schema}].[{table}] OFF")

    status = f"{copied}/{total} rows"
    if errors:
        status += f"  ({errors} errors)"
    print(f"      {schema}.{table}: {status}")


# ── Per-database migration ────────────────────────────────────────────────────

def migrate_db(db_name: str, skip_data: bool):
    print(f"\n{'='*62}")
    print(f"  Database: {db_name}")
    print(f"{'='*62}")

    # Verify source DB is accessible
    try:
        src = src_conn(db_name)
    except Exception as e:
        print(f"  ERROR: Cannot connect to source [{db_name}]: {e}")
        return

    tgt_master = tgt_conn("master")

    if not db_exists(tgt_master, db_name):
        create_database(tgt_master, db_name)
    else:
        print(f"  Database [{db_name}] already exists on target — will add missing tables")

    tgt = tgt_conn(db_name)
    tables = get_tables(src)
    print(f"\n  Source tables: {len(tables)}")

    # ── Pass 1: create missing tables ────────────────────────────
    print("\n  [Pass 1] Schema...")
    table_meta: dict[tuple, bool] = {}
    for schema, table in tables:
        try:
            ddl, has_id = get_table_ddl(src, schema, table)
            table_meta[(schema, table)] = has_id
            if table_exists(tgt, schema, table):
                print(f"    [exists ] {schema}.{table}")
            else:
                tgt.cursor().execute(ddl)
                print(f"    [created] {schema}.{table}")
        except Exception as e:
            print(f"    [ERROR  ] {schema}.{table}: {e}")
            table_meta[(schema, table)] = False

    if skip_data:
        print("\n  [Pass 2] Data skipped (--skip-data)")
    else:
        # ── Pass 2: copy data ─────────────────────────────────────
        print("\n  [Pass 2] Data copy...")
        for schema, table in tables:
            has_id = table_meta.get((schema, table), False)
            try:
                copy_table_data(src, tgt, schema, table, has_id)
            except Exception as e:
                print(f"      [ERROR] {schema}.{table}: {e}")

    src.close()
    tgt.close()
    tgt_master.close()
    print(f"\n  {db_name} migration complete.")


# ── Post-migration setup ──────────────────────────────────────────────────────

def create_app_user():
    print(f"\n[Setup] Creating login [{APP_USER}] on target...")
    try:
        m = tgt_conn("master")
        cur = m.cursor()
        cur.execute("SELECT 1 FROM sys.server_principals WHERE name = ?", APP_USER)
        if cur.fetchone():
            print(f"  Login [{APP_USER}] already exists")
        else:
            cur.execute(f"""
                CREATE LOGIN [{APP_USER}]
                WITH PASSWORD   = N'{APP_PASS}',
                     DEFAULT_DATABASE = [ConversionAgent],
                     CHECK_EXPIRATION = OFF,
                     CHECK_POLICY     = OFF
            """)
            print(f"  [OK] Created login [{APP_USER}]")

        ca = tgt_conn("ConversionAgent")
        cur2 = ca.cursor()
        cur2.execute("SELECT 1 FROM sys.database_principals WHERE name = ?", APP_USER)
        if cur2.fetchone():
            print(f"  User [{APP_USER}] already mapped in ConversionAgent")
        else:
            cur2.execute(f"CREATE USER [{APP_USER}] FOR LOGIN [{APP_USER}]")
            cur2.execute(f"ALTER ROLE [db_owner] ADD MEMBER [{APP_USER}]")
            print(f"  [OK] User [{APP_USER}] created and granted db_owner")

        m.close()
        ca.close()
    except Exception as e:
        print(f"  [warn] Could not create app user: {e}")


def update_env_file():
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        print("  [warn] .env not found")
        return

    content = env_path.read_text(encoding="utf-8")
    # Replace the DB_SERVER value (handles quoted and unquoted forms)
    new_content = re.sub(
        r'(DB_SERVER\s*=\s*)["\']?[^"\'\n]+["\']?',
        f'DB_SERVER="{TGT_SERVER}"',
        content
    )
    if new_content == content:
        print("  [warn] DB_SERVER not found in .env — check manually")
        return

    env_path.write_text(new_content, encoding="utf-8")
    print(f"  [OK] .env updated: DB_SERVER → {TGT_SERVER}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Migrate SQL Server DBs to Azure VM")
    parser.add_argument("--db", default="both",
                        help="DB name to migrate, or 'both' for ConversionAgent+ClientLegacy")
    parser.add_argument("--skip-data",     action="store_true", help="Create schema only")
    parser.add_argument("--no-update-env", action="store_true", help="Skip .env update")
    args = parser.parse_args()

    dbs = ["ConversionAgent", "ClientLegacy"] if args.db == "both" else [args.db]

    print(f"\nMigration started : {datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"Source            : {SRC_SERVER}")
    print(f"Target            : {TGT_SERVER}")
    print(f"Databases         : {', '.join(dbs)}")
    print(f"Mode              : {'schema only' if args.skip_data else 'schema + data'}")

    # Test target connectivity
    print("\n[Check] Connecting to target...")
    try:
        c = tgt_conn("master")
        cur = c.cursor()
        cur.execute("SELECT @@VERSION")
        ver = cur.fetchone()[0].split("\n")[0]
        c.close()
        print(f"  [OK] Target reachable: {ver}")
    except Exception as e:
        print(f"  FAILED: {e}")
        print("\nTroubleshooting tips:")
        print("  • Ensure port 1433 is open in the Azure NSG for your IP")
        print("  • Confirm SQL Server container is running: docker ps")
        print("  • Test: sqlcmd -S 104.211.112.63,1433 -U sa -P Clarity@2026 -Q 'SELECT 1'")
        sys.exit(1)

    # Migrate each database
    for db in dbs:
        migrate_db(db, skip_data=args.skip_data)

    # Create app user (only needed when ConversionAgent was migrated)
    if "ConversionAgent" in dbs:
        create_app_user()

    # Update .env
    if not args.no_update_env:
        print("\n[Config] Updating .env...")
        update_env_file()

    print(f"\nMigration finished: {datetime.now():%Y-%m-%d %H:%M:%S}")
    print("\nNext steps:")
    print("  1. Restart the backend:  .venv/Scripts/python.exe -m uvicorn api.main:app --reload --port 8000")
    print("  2. Verify the app connects and all tables are visible")
    print(f"  3. (Optional) Update saved connections in the app to point to {TGT_SERVER}")


if __name__ == "__main__":
    main()
