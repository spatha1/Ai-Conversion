"""
setup_legacy_connection.py
==========================
Registers the LegacyInsurance source connection in Data Workbench
and prints the conn_id to use with the seeding scripts.

Usage:
    .venv\\Scripts\\python.exe scripts/setup_legacy_connection.py
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # type: ignore
load_dotenv(ROOT / ".env")

import urllib.request, urllib.error

API_BASE  = "http://localhost:8000/api"
ADMIN_USR = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PWD = os.getenv("ADMIN_PASSWORD", "clarity2024")
DB_SERVER = os.getenv("DB_SERVER", "104.211.112.63,1433").strip('"')
DB_USER   = os.getenv("DB_USER", "sa").strip('"')
DB_PWD    = os.getenv("DB_PASSWORD", "Clarity@2026").strip('"')

def api_post(path: str, payload: dict, token: str | None = None) -> dict:
    url  = f"{API_BASE}{path}"
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data,
           headers={"Content-Type": "application/json",
                    **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def api_get(path: str, token: str) -> dict | list:
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(url,
          headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def main():
    # ── Login ──────────────────────────────────────────────────
    print(f"Logging in as {ADMIN_USR} ...")
    try:
        auth = api_post("/auth/login", {"username": ADMIN_USR, "password": ADMIN_PWD})
        token = auth["access_token"]
        print("  Logged in.")
    except Exception as e:
        print(f"  ERROR: Login failed — is the backend running? ({e})")
        sys.exit(1)

    # ── Get or create first project ────────────────────────────
    projects = api_get("/projects", token)
    if not projects:
        print("Creating a demo project ...")
        proj = api_post("/projects",
            {"name": "Duck Creek P&C Conversion", "description": "Legacy to Duck Creek demo"},
            token)
        proj_id = proj["id"]
    else:
        proj_id = projects[0]["id"]
    print(f"  Using project id={proj_id}")

    # ── Check if connection already exists ─────────────────────
    connections = api_get(f"/connections?project_id={proj_id}", token)
    existing = [c for c in connections if "Legacy Insurance" in c.get("name","")]
    if existing:
        cid = existing[0]["id"]
        print(f"  Connection already exists: id={cid} — {existing[0]['name']}")
    else:
        # ── Create P&C (AUTO/HOME) connection ──────────────────
        print("Creating 'Legacy Insurance — P&C Source' connection ...")
        conn = api_post("/connections", {
            "name":          "Legacy Insurance — P&C Source",
            "source_type":   "sql",
            "dialect":       "mssql",
            "host":          DB_SERVER,
            "port":          None,
            "database_name": "LegacyInsurance",
            "schema_name":   "legacy",
            "username":      DB_USER,
            "password":      DB_PWD,
            "project_id":    proj_id,
        }, token)
        cid = conn["id"]
        print(f"  Created connection: id={cid}")

    # ── Test connection ────────────────────────────────────────
    print("Testing connection ...")
    try:
        result = api_post(f"/connections/{cid}/test", {}, token)
        print(f"  Test result: {result}")
    except Exception as e:
        print(f"  Warning: connection test failed ({e}) — check DB accessibility")

    print(f"\n✓ Connection ID = {cid}")
    print(f"  Next steps:")
    print(f"  .venv\\Scripts\\python.exe scripts/seed_legacy_transformation_rules.py --conn-id {cid}")
    print(f"  .venv\\Scripts\\python.exe scripts/seed_legacy_knowledge.py")
    return cid

if __name__ == "__main__":
    main()
