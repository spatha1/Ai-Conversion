# setup_db.py  -- one-time database bootstrap script
#
# What it does:
#   1. Connects to [master] as admin (Windows auth or SA)
#   2. Creates the [ConversionAgent] database if it does not exist
#   3. Creates the SQL Server login for the app user if missing
#   4. Maps that login as a user in [ConversionAgent] with db_owner
#   5. Uses SQLAlchemy to create all application tables
#
# Usage (Windows / Trusted auth -- recommended for local dev):
#   python -m api.setup_db
#
# Usage (SQL Server auth -- e.g. SA on a remote server):
#   python -m api.setup_db --admin-user sa --admin-password <pass>
#
# Run from the project root:
#   cd C:\Users\Admin-1\Desktop\Conversionproject
#   python -m api.setup_db
import argparse
import sys

import pyodbc

from api.config import settings
from api.database import engine, Base
import api.models  # noqa: F401 -- registers all ORM models with Base


def _conn_str(server, db, driver, user="", password=""):
    auth = f"UID={user};PWD={password}" if user else "Trusted_Connection=yes"
    return (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={db};"
        f"{auth};"
        f"TrustServerCertificate=yes;"
        f"Encrypt=no"
    )


def _connect(server, db, driver, user="", password=""):
    return pyodbc.connect(
        _conn_str(server, db, driver, user, password),
        autocommit=True,
        timeout=15,
    )


def bootstrap(admin_user="", admin_password=""):
    server   = settings.DB_SERVER
    db_name  = settings.DB_NAME
    app_user = settings.DB_USER
    app_pass = settings.DB_PASSWORD
    driver   = settings.DB_DRIVER

    print("=" * 60)
    print("  ConversionAgent  --  Database Bootstrap")
    print("=" * 60)
    print(f"  Server   : {server}")
    print(f"  Database : {db_name}")
    print(f"  App user : {app_user}")
    print(f"  Admin    : {admin_user or '(Windows auth)'}")
    print("=" * 60)

    # Step 1: admin connection to [master]
    print("\nStep 1  Connecting to [master] as admin ...")
    try:
        master = _connect(server, "master", driver, admin_user, admin_password)
    except Exception as exc:
        print(f"\n  [FAIL] Connection failed: {exc}")
        print(
            "\n  Hint: run with --admin-user sa --admin-password <pass>\n"
            "        or ensure your Windows account has sysadmin rights."
        )
        sys.exit(1)

    cur = master.cursor()
    print("  [OK] Connected to [master]")

    # Step 2: create database
    print(f"\nStep 2  Creating database [{db_name}] ...")
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = ?) "
        f"CREATE DATABASE [{db_name}]",
        db_name,
    )
    print(f"  [OK] Database [{db_name}] ready")

    # Step 3: create login
    print(f"\nStep 3  Creating login [{app_user}] ...")
    cur.execute(
        "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = ?) "
        f"CREATE LOGIN [{app_user}] WITH PASSWORD = N'{app_pass}'",
        app_user,
    )
    print(f"  [OK] Login [{app_user}] ready")
    master.close()

    # Step 4: create DB user + grant db_owner
    print(f"\nStep 4  Granting [{app_user}] db_owner in [{db_name}] ...")
    try:
        db_admin = _connect(server, db_name, driver, admin_user, admin_password)
        db_cur = db_admin.cursor()
        db_cur.execute(
            "IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = ?) "
            f"CREATE USER [{app_user}] FOR LOGIN [{app_user}]",
            app_user,
        )
        db_cur.execute(f"ALTER ROLE db_owner ADD MEMBER [{app_user}]")
        db_admin.close()
        print(f"  [OK] User [{app_user}] is db_owner in [{db_name}]")
    except Exception as exc:
        print(f"  [WARN] Could not grant db_owner: {exc}")
        print("    The user may already exist, or grant permissions manually.")

    # Step 5: create all application tables via SQLAlchemy
    print(f"\nStep 5  Creating application tables in [{db_name}] ...")
    try:
        Base.metadata.create_all(bind=engine)
        tables = sorted(Base.metadata.tables.keys())
        for t in tables:
            print(f"  [OK] {t}")
        print(f"\n  {len(tables)} table(s) created / verified")
    except Exception as exc:
        print(f"\n  [FAIL] Table creation failed: {exc}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("  Bootstrap complete - all objects ready in ConversionAgent")
    print("=" * 60)
    print(
        "\nTo start the API:\n"
        "  uvicorn api.main:app --reload --port 8000\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Bootstrap the ConversionAgent SQL Server database."
    )
    parser.add_argument(
        "--admin-user", default="",
        help="SQL Server admin login (blank = Windows auth)",
    )
    parser.add_argument(
        "--admin-password", default="",
        help="SQL Server admin password",
    )
    args = parser.parse_args()
    bootstrap(args.admin_user, args.admin_password)
