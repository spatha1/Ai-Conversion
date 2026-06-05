"""
generate_legacy_data.py
=======================
Generates realistic legacy insurance data for the LegacyInsurance database.

Usage:
    .venv\\Scripts\\python.exe scripts/generate_legacy_data.py
    .venv\\Scripts\\python.exe scripts/generate_legacy_data.py --reset   # drop & recreate tables

Targets: 104.211.112.63,1433  /  LegacyInsurance  /  sa  (reads from .env)
Data volumes:
  PolicyMaster     5,000   PolicyTerm      5,500   PolicyTransaction 15,000
  NamedInsured     6,000   Address         8,000   Location          5,500
  Vehicle         10,000   Driver          8,000   Coverage         25,000
  CoverageLimit   20,000   CoverageDeductible 15,000   Premium      25,000
  Agency            100    Producer          300   PolicyNotes      10,000
"""
from __future__ import annotations

import os
import sys
import json
import random
import datetime
import argparse
import pyodbc
from decimal import Decimal
from pathlib import Path

# ── resolve project root so we can read .env ───────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # type: ignore
load_dotenv(ROOT / ".env")

try:
    from faker import Faker  # type: ignore
except ImportError:
    print("Installing faker...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "faker", "-q"])
    from faker import Faker

Faker.seed(42)
random.seed(42)
fake = Faker("en_US")

# ── DB connection ───────────────────────────────────────────────
DB_SERVER   = os.getenv("DB_SERVER",   "104.211.112.63,1433").strip('"')
DB_USER     = os.getenv("DB_USER",     "sa").strip('"')
DB_PASSWORD = os.getenv("DB_PASSWORD", "Clarity@2026").strip('"')
DB_DRIVER   = os.getenv("DB_DRIVER",   "ODBC Driver 17 for SQL Server").strip('"')

LEGACY_DB = "LegacyInsurance"

CONN_STR = (
    f"DRIVER={{{DB_DRIVER}}};"
    f"SERVER={DB_SERVER};"
    f"DATABASE={LEGACY_DB};"
    f"UID={DB_USER};"
    f"PWD={DB_PASSWORD};"
    "TrustServerCertificate=yes;Encrypt=no;"
)

def get_conn():
    return pyodbc.connect(CONN_STR, autocommit=False)

def batch_insert(cur, sql: str, rows: list, batch_size: int = 500):
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            cur.executemany(sql, batch)
            cur.connection.commit()
            inserted += len(batch)
        except Exception as e:
            cur.connection.rollback()
            # Skip duplicate-key rows — insert one-by-one
            for row in batch:
                try:
                    cur.execute(sql, row)
                    cur.connection.commit()
                    inserted += 1
                except Exception:
                    cur.connection.rollback()
    print(f"  Inserted {inserted:,} rows")

# ── Reference data (domain constants) ──────────────────────────
STATES_WEIGHTED = (
    ["TX"] * 30 + ["CA"] * 25 + ["FL"] * 20 + ["NY"] * 15 + ["AZ"] * 10
)
STATES_ALL = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
    "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY",
]
LOB_DIST   = (["AUTO"]*40 + ["HOME"]*25 + ["GL"]*15 + ["WC"]*10 + ["COMM_AUTO"]*10)
POL_STATUS = (["A"]*70 + ["C"]*15 + ["P"]*5 + ["E"]*7 + ["R"]*3)
GNDR       = ["M", "F", "U"]
MARITAL    = ["S", "M", "D", "W"]
CVG_CODES_AUTO  = ["BI", "PD", "COMP", "COLL", "MED", "UM", "UIM", "RENT", "TURO"]
CVG_CODES_HOME  = ["FIRE", "THFT", "WIND", "LIAB"]
CVG_CODES_COMM  = ["BI", "PD", "COMP", "COLL", "LIAB"]
CVG_CODES_WC    = ["WC"]
VEH_MAKES  = ["Toyota","Honda","Ford","Chevrolet","Nissan","Dodge","BMW","Mercedes",
               "Hyundai","Kia","Jeep","Ram","GMC","Subaru","Volkswagen","Tesla","Lexus"]
VEH_MODELS = {
    "Toyota":["Camry","Corolla","RAV4","Highlander","Tacoma","Sienna"],
    "Honda":["Civic","Accord","CR-V","Pilot","Odyssey","HR-V"],
    "Ford":["F-150","Explorer","Escape","Mustang","Edge","Ranger"],
    "Chevrolet":["Silverado","Equinox","Traverse","Malibu","Colorado","Tahoe"],
    "Nissan":["Altima","Sentra","Rogue","Pathfinder","Frontier","Murano"],
    "Dodge":["Durango","Challenger","Charger","Grand Caravan","Ram"],
    "BMW":["3 Series","5 Series","X3","X5","7 Series"],
    "Mercedes":["C-Class","E-Class","GLC","GLE","S-Class"],
    "Hyundai":["Elantra","Sonata","Tucson","Santa Fe","Palisade"],
    "Kia":["Forte","K5","Sportage","Telluride","Soul"],
    "Jeep":["Cherokee","Grand Cherokee","Wrangler","Compass"],
    "Ram":["1500","2500","ProMaster"],
    "GMC":["Sierra","Terrain","Acadia","Yukon"],
    "Subaru":["Outback","Forester","Impreza","Crosstrek","Legacy"],
    "Volkswagen":["Jetta","Passat","Tiguan","Atlas","Golf"],
    "Tesla":["Model 3","Model Y","Model S","Model X"],
    "Lexus":["IS","ES","RX","GX","NX"],
}
VEH_TYPES = ["PP","SUV","TRK","VAN","MC","SUV","PP","PP","PP","TRK"]

CARRIER_CDS = ["LIC01","LIC02","LIC03","LIC04"]
UNDWTR_CDS  = ["UW001","UW002","UW003","UW004","UW005"]
TRANS_TYPES = ["NB","RN","EN","CN","RE","CH"]
NOTE_TYPES  = ["GEN","UNDW","BILL","CLMS"]
NOTE_TEMPLATES = [
    "Policy reviewed and approved by underwriting on {dt}.",
    "Customer called regarding premium increase. Explained surcharge factors.",
    "Address change processed. New address verified.",
    "Added vehicle {n} to policy per customer request.",
    "Excluded driver {n} per customer request. Exclusion form signed.",
    "Policy renewed automatically. No changes from prior term.",
    "Cancellation notice sent. Payment not received by due date.",
    "Reinstatement processed. Payment received and cleared.",
    "Coverage change endorsed. BI limits increased.",
    "Audit completed. No adjustments required.",
    "MVR ordered for driver review.",
    "Inspection completed. Property in acceptable condition.",
    "Billing plan changed to monthly installments.",
    "Discount applied: multi-policy, good driver.",
    "Rate review scheduled for renewal.",
]

def rand_date_between(start_yr: int, end_yr: int) -> datetime.date:
    start = datetime.date(start_yr, 1, 1)
    end   = datetime.date(end_yr, 12, 31)
    delta = (end - start).days
    return start + datetime.timedelta(days=random.randint(0, delta))

def rand_eff_exp(base_yr: int) -> tuple[datetime.date, datetime.date]:
    eff = rand_date_between(base_yr - 3, base_yr)
    exp = eff + datetime.timedelta(days=365)
    return eff, exp

def make_vin() -> str:
    chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
    return "".join(random.choices(chars, k=17))

def make_license_plate(state: str) -> str:
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    digits  = "0123456789"
    return (random.choice(letters) + random.choice(letters) + random.choice(letters)
            + random.choice(digits) + random.choice(digits) + random.choice(digits))

def make_policy_no(i: int) -> str:
    return f"P{1001 + i:05d}"

def prem_dist() -> float:
    """Log-normal premium distribution: ~$500-$25000, mean ~$3200."""
    while True:
        v = random.lognormvariate(8.0, 0.7)
        if 300 <= v <= 30000:
            return round(v, 2)

# ─────────────────────────────────────────────────────────────────────────────
# Main generation
# ─────────────────────────────────────────────────────────────────────────────

def run(reset: bool = False):
    print(f"\nConnecting to {DB_SERVER} / {LEGACY_DB} ...")
    con = get_conn()
    cur = con.cursor()
    print("  Connected.")

    if reset:
        print("\nDropping and recreating tables (--reset) ...")
        _drop_tables(cur)
        con.commit()
        # Recreate tables + reference data via the DDL scripts
        import subprocess, sys
        ddl_dir = Path(__file__).resolve().parent.parent / "SQL" / "legacy_insurance"
        odbc_conn = (
            f"DRIVER={{{DB_DRIVER}}};SERVER={DB_SERVER};DATABASE={LEGACY_DB};"
            f"UID={DB_USER};PWD={DB_PASSWORD};TrustServerCertificate=yes;Encrypt=no;"
        )
        for script in ["02_create_tables.sql", "03_reference_data.sql"]:
            print(f"  Running {script} ...")
            result = subprocess.run(
                ["sqlcmd", "-S", DB_SERVER, "-U", DB_USER, "-P", DB_PASSWORD,
                 "-d", LEGACY_DB, "-i", str(ddl_dir / script)],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                print(f"  ERROR: {result.stderr[:300]}")
                sys.exit(1)
        # Re-open connection after DDL
        con.close()
        con = get_conn()
        cur = con.cursor()
        print("  Tables recreated.")

    # ── 1. Agencies ────────────────────────────────────────────
    print("\n[1/15] Agencies ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Agency").fetchone()[0]
    if existing == 0:
        agency_rows = []
        agency_cds  = []
        for i in range(100):
            acd = f"AGY{i+1:04d}"
            agency_cds.append(acd)
            eff = rand_date_between(2000, 2015)
            agency_rows.append((
                acd,
                fake.company() + " Insurance Agency",
                random.choice(["IND","CAPT","DRCT"]),
                fake.street_address(),
                fake.city(),
                random.choice(STATES_ALL),
                fake.zipcode(),
                fake.phone_number()[:15],
                round(random.uniform(8, 15), 2),
                eff,
                None,
                "Y",
            ))
        batch_insert(cur,
            "INSERT INTO legacy.Agency (AGCY_CD,AGCY_NM,AGCY_TYP_CD,ADDR_LN1,CITY_NM,ST_CD,"
            "ZIP_CD,PHN_NO,COMM_PCT,EFF_DT,EXP_DT,ACTV_FL) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            agency_rows)
    else:
        agency_cds = [r[0] for r in cur.execute("SELECT AGCY_CD FROM legacy.Agency").fetchall()]
        print(f"  {existing} agencies already exist — skipped.")

    # ── 2. Producers ───────────────────────────────────────────
    print("\n[2/15] Producers ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Producer").fetchone()[0]
    if existing == 0:
        prod_rows = []
        for i in range(300):
            eff = rand_date_between(2005, 2018)
            prod_rows.append((
                f"PRD{i+1:05d}",
                random.choice(agency_cds),
                fake.name(),
                random.choice(["AGNT","BRKR"]),
                f"LIC{random.randint(100000,999999)}",
                random.choice(STATES_ALL),
                eff + datetime.timedelta(days=365*3),
                fake.phone_number()[:15],
                fake.email(),
                eff,
                None,
                "Y",
            ))
        batch_insert(cur,
            "INSERT INTO legacy.Producer (PROD_CD,AGCY_CD,PROD_NM,PROD_TYP_CD,LIC_NO,"
            "LIC_ST_CD,LIC_EXP_DT,PHN_NO,EML_ADDR,EFF_DT,EXP_DT,ACTV_FL) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            prod_rows)
        prod_cds = [r[0] for r in prod_rows]
    else:
        prod_cds = [r[0] for r in cur.execute("SELECT PROD_CD FROM legacy.Producer").fetchall()]
        print(f"  {existing} producers already exist — skipped.")

    # ── 3. PolicyMaster ────────────────────────────────────────
    print("\n[3/15] PolicyMaster (5,000 policies) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.PolicyMaster").fetchone()[0]
    if existing == 0:
        pol_rows = []
        pol_nos  = []
        for i in range(5000):
            pno    = make_policy_no(i)
            pol_nos.append(pno)
            lob    = random.choice(LOB_DIST)
            sts    = random.choice(POL_STATUS)
            st     = random.choice(STATES_WEIGHTED)
            prem   = prem_dist()
            eff, exp = rand_eff_exp(2020)
            cancel_dt = None
            if sts == "C":
                cancel_dt = eff + datetime.timedelta(days=random.randint(30, 300))
            tier = "GOLD" if prem > 10000 else "STD"
            pol_rows.append((
                pno,
                sts,
                lob,
                random.choice(["STD","SPEC","COMM"]) if lob.startswith("COMM") else "STD",
                random.choice(CARRIER_CDS),
                None,                           # PROG_CD
                random.choice(agency_cds),
                random.choice(prod_cds),
                random.choice(UNDWTR_CDS),
                eff,
                exp,
                cancel_dt,
                random.choice(["NP","NPS","OT",None]),
                st,
                prem,
                "LIC",
                "SYSTEM",
                "SYSTEM",
                tier,
                0,
            ))
        batch_insert(cur,
            "INSERT INTO legacy.PolicyMaster "
            "(POL_NO,POL_STATUS,LOB_CD,POL_TYP_CD,CARRIER_CD,PROG_CD,AGCY_CD,PROD_CD,"
            "UNDWTR_CD,EFF_DT,EXP_DT,CANCEL_DT,CANCEL_RSN_CD,STATE_CD,ANN_PREM_AMT,"
            "CMPNY_CD,ENTRY_USR_ID,LAST_UPD_USR_ID,TIER_CD,RENEWAL_NO) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            pol_rows)
    else:
        pol_nos = [r[0] for r in cur.execute("SELECT POL_NO FROM legacy.PolicyMaster").fetchall()]
        print(f"  {existing} policies already exist — skipped.")

    # ── 4. PolicyTerm ──────────────────────────────────────────
    print("\n[4/15] PolicyTerm ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.PolicyTerm").fetchone()[0]
    if existing == 0:
        term_rows = []
        term_id   = 1
        for pno in pol_nos:
            n_terms = random.choices([1, 2, 3], weights=[70, 20, 10])[0]
            prior   = None
            eff     = rand_date_between(2015, 2022)
            for t in range(n_terms):
                exp = eff + datetime.timedelta(days=365)
                term_rows.append((
                    term_id, pno, t + 1,
                    eff, exp,
                    prior,
                    term_id - 1 if prior else None,
                    round(prem_dist(), 2),
                    "A",
                ))
                prior = pno
                eff   = exp
                term_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.PolicyTerm "
            "(TERM_ID,POL_NO,TERM_NO,TERM_EFF_DT,TERM_EXP_DT,PRIOR_POL_NO,"
            "PRIOR_TERM_ID,TERM_PREM_AMT,TERM_STS_CD) VALUES (?,?,?,?,?,?,?,?,?)",
            term_rows)
    else:
        print(f"  {existing} terms already exist — skipped.")

    # ── 5. PolicyTransaction ───────────────────────────────────
    print("\n[5/15] PolicyTransaction (15,000) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.PolicyTransaction").fetchone()[0]
    if existing == 0:
        trans_rows = []
        for tid in range(1, 15001):
            pno     = random.choice(pol_nos)
            typ     = random.choice(TRANS_TYPES)
            trans_dt = fake.date_time_between(start_date="-5y", end_date="now")
            eff_dt   = trans_dt.date()
            old_prem = round(prem_dist(), 2)
            chng     = round(random.uniform(-500, 500), 2)
            trans_rows.append((
                tid, pno, typ,
                trans_dt, eff_dt,
                random.choice(["NP","OT","UW","EL",None]),
                chng,
                old_prem,
                old_prem + chng,
                f"USR{random.randint(1,20):03d}",
                f"BTH{random.randint(1000,9999)}",
                None,
            ))
        batch_insert(cur,
            "INSERT INTO legacy.PolicyTransaction "
            "(TRANS_ID,POL_NO,TRANS_TYP_CD,TRANS_DT,TRANS_EFF_DT,REASON_CD,"
            "CHNG_PREM_AMT,PRIOR_PREM_AMT,NEW_PREM_AMT,USER_ID,BATCH_NO,PROC_DT) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            trans_rows)
    else:
        print(f"  {existing} transactions already exist — skipped.")

    # ── 6. NamedInsured ────────────────────────────────────────
    print("\n[6/15] NamedInsured ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.NamedInsured").fetchone()[0]
    if existing == 0:
        insd_rows = []
        insd_id   = 1
        insd_map  = {}   # pol_no -> list of insd_ids
        for pno in pol_nos:
            n = random.choices([1, 2], weights=[80, 20])[0]
            insd_map[pno] = []
            for j in range(n):
                fn = fake.first_name()
                ln = fake.last_name()
                dob = rand_date_between(1950, 2000)
                insd_rows.append((
                    insd_id, pno,
                    "PRI" if j == 0 else "SEC",
                    f"{fn} {ln}",
                    fn, ln,
                    f"XXX-XX-{random.randint(1000,9999)}",  # masked SSN
                    dob,
                    random.choice(GNDR),
                    random.choice(MARITAL),
                    f"OCC{random.randint(100,999)}",
                ))
                insd_map[pno].append(insd_id)
                insd_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.NamedInsured "
            "(INSD_ID,POL_NO,INSD_TYP_CD,INSD_NM,INSD_FRST_NM,INSD_LST_NM,"
            "SSN_TIN,DOB_DT,GNDR_CD,MARITAL_STS_CD,OCC_CD) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            insd_rows)
    else:
        insd_map = {}
        for r in cur.execute("SELECT INSD_ID, POL_NO FROM legacy.NamedInsured").fetchall():
            insd_map.setdefault(r[1], []).append(r[0])
        print(f"  {existing} insureds already exist — skipped.")

    # ── 7. Address ─────────────────────────────────────────────
    print("\n[7/15] Address ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Address").fetchone()[0]
    if existing == 0:
        addr_rows = []
        addr_id   = 1
        addr_map  = {}   # pol_no -> list of addr_ids
        for pno in pol_nos:
            n = random.choices([1, 2], weights=[65, 35])[0]
            addr_map[pno] = []
            for j, typ in enumerate(["MAIL", "RISK"] if n > 1 else ["MAIL"]):
                st = random.choice(STATES_WEIGHTED)
                addr_rows.append((
                    addr_id, pno, typ,
                    fake.street_address(),
                    None,
                    fake.city(), st,
                    fake.zipcode(),
                    None, "USA",
                ))
                addr_map[pno].append(addr_id)
                addr_id += 1
            # billing
            if random.random() < 0.3:
                addr_rows.append((
                    addr_id, pno, "BILL",
                    fake.street_address(), None,
                    fake.city(), random.choice(STATES_ALL),
                    fake.zipcode(), None, "USA",
                ))
                addr_map[pno].append(addr_id)
                addr_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.Address "
            "(ADDR_ID,POL_NO,ADDR_TYP_CD,ADDR_LN1,ADDR_LN2,"
            "CITY_NM,ST_CD,ZIP_CD,CNTY_CD,CTRY_CD) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            addr_rows)
    else:
        addr_map = {}
        for r in cur.execute("SELECT ADDR_ID, POL_NO FROM legacy.Address").fetchall():
            addr_map.setdefault(r[1], []).append(r[0])
        print(f"  {existing} addresses already exist — skipped.")

    # ── 8. Location ────────────────────────────────────────────
    print("\n[8/15] Location ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Location").fetchone()[0]
    if existing == 0:
        loc_rows = []
        loc_id   = 1
        loc_map  = {}
        for pno in pol_nos:
            n = random.choices([1, 2], weights=[80, 20])[0]
            loc_map[pno] = []
            aids = addr_map.get(pno, [None])
            for j in range(n):
                loc_rows.append((
                    loc_id, pno, j + 1,
                    f"Location {j+1} - {fake.street_address()}",
                    aids[j % len(aids)] if aids else None,
                    random.choice(["RES","COMM",None]),
                    random.choice(["FR","MAS","TF",None]),
                    random.randint(1970, 2018) if random.random() < 0.7 else None,
                    random.randint(800, 4000) if random.random() < 0.5 else None,
                ))
                loc_map[pno].append(loc_id)
                loc_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.Location "
            "(LOC_ID,POL_NO,LOC_NO,LOC_DESC,ADDR_ID,BLDG_TYP_CD,CNST_TYP_CD,YR_BUILT,SQ_FT) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            loc_rows)
    else:
        loc_map = {}
        for r in cur.execute("SELECT LOC_ID, POL_NO FROM legacy.Location").fetchall():
            loc_map.setdefault(r[1], []).append(r[0])
        print(f"  {existing} locations already exist — skipped.")

    # ── 9. Vehicle ─────────────────────────────────────────────
    print("\n[9/15] Vehicle (10,000) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Vehicle").fetchone()[0]
    if existing == 0:
        veh_rows = []
        veh_id   = 1
        veh_map  = {}
        # Every AUTO / COMM_AUTO policy gets vehicles
        auto_pols = [r[0] for r in cur.execute(
            "SELECT POL_NO FROM legacy.PolicyMaster WHERE LOB_CD IN ('AUTO','COMM_AUTO')"
        ).fetchall()]
        # Distribute 10,000 vehicles across AUTO policies
        per_pol = max(1, 10000 // max(len(auto_pols), 1))
        for pno in auto_pols:
            n = min(random.choices([1,2,3,4], weights=[50,30,15,5])[0], per_pol)
            veh_map[pno] = []
            for j in range(n):
                mk = random.choice(VEH_MAKES)
                mdl = random.choice(VEH_MODELS.get(mk, ["Unknown"]))
                yr  = random.randint(2005, 2023)
                vt  = random.choice(VEH_TYPES)
                veh_rows.append((
                    veh_id, pno, j + 1,
                    yr, mk, mdl,
                    random.choice(["4DR","2DR","CPE","SUV","TRK","VAN"]),
                    vt,
                    make_vin(),
                    make_license_plate(random.choice(STATES_WEIGHTED)),
                    random.choice(STATES_WEIGHTED),
                    random.randint(3000, 25000) if vt in ("CTK","TRK") else None,
                    random.choice(["PL","BUS","FM","CO"]),
                    random.choice(STATES_WEIGHTED),
                    random.randint(5000, 35000),
                    f"SYM{random.randint(1,30):02d}",
                    f"TER{random.randint(1,10):02d}",
                ))
                veh_map[pno].append(veh_id)
                veh_id += 1
                if veh_id > 10001:
                    break
            if veh_id > 10001:
                break
        # Fill remaining to ~10,000
        remaining = 10000 - len(veh_rows)
        if remaining > 0:
            extra_pols = random.choices(auto_pols, k=remaining)
            for pno in extra_pols:
                mk = random.choice(VEH_MAKES)
                mdl = random.choice(VEH_MODELS.get(mk, ["Unknown"]))
                yr  = random.randint(2005, 2023)
                veh_rows.append((
                    veh_id, pno,
                    len(veh_map.get(pno, [])) + 1,
                    yr, mk, mdl,
                    random.choice(["4DR","2DR","SUV","TRK"]),
                    random.choice(VEH_TYPES),
                    make_vin(),
                    make_license_plate(random.choice(STATES_WEIGHTED)),
                    random.choice(STATES_WEIGHTED),
                    None,
                    "PL",
                    random.choice(STATES_WEIGHTED),
                    random.randint(5000, 25000),
                    f"SYM{random.randint(1,30):02d}",
                    f"TER{random.randint(1,10):02d}",
                ))
                veh_map.setdefault(pno, []).append(veh_id)
                veh_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.Vehicle "
            "(VEH_ID,POL_NO,VEH_NO,VEH_YR,VEH_MK,VEH_MDL,VEH_BODY_CD,VEH_TYP_CD,"
            "VIN_NO,LIC_PLTE_NO,LIC_ST_CD,GRS_VEH_WT,USE_CD,GARAGING_ST_CD,"
            "ANN_MILEAGE,SYMBOL_CD,RATING_TER_CD) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            veh_rows)
    else:
        veh_map = {}
        for r in cur.execute("SELECT VEH_ID, POL_NO FROM legacy.Vehicle").fetchall():
            veh_map.setdefault(r[1], []).append(r[0])
        print(f"  {existing} vehicles already exist — skipped.")

    # ── 10. Driver ─────────────────────────────────────────────
    print("\n[10/15] Driver (8,000) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Driver").fetchone()[0]
    if existing == 0:
        drvr_rows = []
        drvr_id   = 1
        auto_pols_list = list(veh_map.keys())
        for i in range(8000):
            pno   = random.choice(auto_pols_list)
            iids  = insd_map.get(pno, [None])
            iid   = random.choice(iids) if iids else None
            st    = random.choice(STATES_WEIGHTED)
            dob   = rand_date_between(1960, 2002)
            sts   = random.choices(["PRM","OCC","EXC","LIST"], weights=[60,25,10,5])[0]
            acc   = random.choices([0,1,2,3,4], weights=[60,20,10,6,4])[0]
            vio   = random.choices([0,1,2,3],   weights=[65,20,10,5])[0]
            drvr_rows.append((
                drvr_id, pno,
                min(i % 4 + 1, 4),
                sts,
                iid,
                f"D{st}{random.randint(100000,999999)}",
                st,
                rand_date_between(2000, 2020),
                random.choice(["REG","CDL","PROV",None]),
                dob,
                random.choice(GNDR),
                random.choice(MARITAL),
                f"OCC{random.randint(100,999)}",
                acc,
                vio,
                "Y" if acc > 2 else "N",
                acc * 2 + vio,
            ))
            drvr_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.Driver "
            "(DRVR_ID,POL_NO,DRVR_NO,DRVR_STATUS_CD,INSD_ID,LIC_NO,LIC_ST_CD,"
            "LIC_DT,LIC_TYP_CD,DOB_DT,GNDR_CD,MARITAL_STS_CD,OCC_CD,"
            "ACCIDENTS_CNT,VIOLATIONS_CNT,SR22_FL,PTS_TOTAL) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            drvr_rows)
    else:
        print(f"  {existing} drivers already exist — skipped.")

    # ── 11. Coverage ───────────────────────────────────────────
    print("\n[11/15] Coverage (25,000) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Coverage").fetchone()[0]
    if existing == 0:
        cvg_rows = []
        cvg_id   = 1
        cvg_map  = {}   # pol_no -> list of cvg_ids

        # Per-policy info
        pol_lob = {r[0]: r[1] for r in cur.execute(
            "SELECT POL_NO, LOB_CD FROM legacy.PolicyMaster"
        ).fetchall()}
        pol_eff = {r[0]: r[1] for r in cur.execute(
            "SELECT POL_NO, EFF_DT FROM legacy.PolicyMaster"
        ).fetchall()}
        pol_exp = {r[0]: r[1] for r in cur.execute(
            "SELECT POL_NO, EXP_DT FROM legacy.PolicyMaster"
        ).fetchall()}

        for pno in pol_nos:
            lob   = pol_lob.get(pno, "AUTO")
            eff   = pol_eff.get(pno, datetime.date(2020, 1, 1))
            exp   = pol_exp.get(pno, datetime.date(2021, 1, 1))
            vehs  = veh_map.get(pno, [None])
            locs  = loc_map.get(pno, [None])
            cvg_map[pno] = []

            if lob in ("AUTO", "COMM_AUTO"):
                cvg_codes = CVG_CODES_AUTO if lob == "AUTO" else CVG_CODES_COMM
                for vid in vehs:
                    for cc in random.sample(cvg_codes, min(5, len(cvg_codes))):
                        cvg_rows.append((
                            cvg_id, pno, vid, None, cc, cc,
                            eff, exp, "A",
                            f"FORM-{cc}-{random.randint(100,999)}",
                            None,
                        ))
                        cvg_map[pno].append(cvg_id)
                        cvg_id += 1
                        if cvg_id > 25001:
                            break
                    if cvg_id > 25001:
                        break
            elif lob == "HOME":
                for lid in locs:
                    for cc in random.sample(CVG_CODES_HOME, min(4, len(CVG_CODES_HOME))):
                        cvg_rows.append((
                            cvg_id, pno, None, lid, cc, cc,
                            eff, exp, "A",
                            f"FORM-{cc}-{random.randint(100,999)}",
                            None,
                        ))
                        cvg_map[pno].append(cvg_id)
                        cvg_id += 1
            elif lob == "WC":
                cvg_rows.append((
                    cvg_id, pno, None, None, "WC", "WC",
                    eff, exp, "A", "FORM-WC-001", None,
                ))
                cvg_map[pno].append(cvg_id)
                cvg_id += 1
            else:
                for cc in ["LIAB", "BI", "PD"]:
                    cvg_rows.append((
                        cvg_id, pno, None, None, cc, cc,
                        eff, exp, "A",
                        f"FORM-{cc}-{random.randint(100,999)}",
                        None,
                    ))
                    cvg_map[pno].append(cvg_id)
                    cvg_id += 1

        batch_insert(cur,
            "INSERT INTO legacy.Coverage "
            "(CVG_ID,POL_NO,VEH_ID,LOC_ID,CVG_CD,CVG_TYP_CD,EFF_DT,EXP_DT,"
            "CVG_STS_CD,FORM_NO,ENDORS_NO) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            cvg_rows)
        all_cvg_ids = [r[0] for r in cvg_rows]
    else:
        cvg_map = {}
        all_cvg_ids = []
        for r in cur.execute("SELECT CVG_ID, POL_NO FROM legacy.Coverage").fetchall():
            cvg_map.setdefault(r[1], []).append(r[0])
            all_cvg_ids.append(r[0])
        print(f"  {existing} coverages already exist — skipped.")

    # ── 12. CoverageLimit ──────────────────────────────────────
    print("\n[12/15] CoverageLimit ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.CoverageLimit").fetchone()[0]
    if existing == 0:
        lmt_rows = []
        lmt_id   = 1
        limit_opts = [25000, 50000, 100000, 250000, 300000, 500000, 1000000]
        for cid in all_cvg_ids:
            lmt_rows.append((
                lmt_id, cid, "POCC",
                random.choice(limit_opts),
                random.choice(limit_opts) * 2,
                random.choice(limit_opts),
                random.choice(limit_opts),
            ))
            lmt_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.CoverageLimit "
            "(LMT_ID,CVG_ID,LMT_TYP_CD,PER_OCCUR_LMT,AGG_LMT,PER_PERSON_LMT,PROP_LMT) "
            "VALUES (?,?,?,?,?,?,?)",
            lmt_rows)
    else:
        print(f"  {existing} limits already exist — skipped.")

    # ── 13. CoverageDeductible ────────────────────────────────
    print("\n[13/15] CoverageDeductible ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.CoverageDeductible").fetchone()[0]
    if existing == 0:
        ded_rows = []
        ded_id   = 1
        ded_amts = [0, 250, 500, 1000, 2500, 5000]
        # ~60% of coverages have a deductible
        sample_cvgs = random.sample(all_cvg_ids, min(15000, len(all_cvg_ids)))
        for cid in sample_cvgs:
            ded_rows.append((
                ded_id, cid,
                random.choice(["FLAT","PCT"]),
                random.choice(ded_amts),
                None,
                random.choice(["LOSS","VALUE"]),
            ))
            ded_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.CoverageDeductible "
            "(DED_ID,CVG_ID,DED_TYP_CD,DED_AMT,DED_PCT,DED_BASIS_CD) "
            "VALUES (?,?,?,?,?,?)",
            ded_rows)
    else:
        print(f"  {existing} deductibles already exist — skipped.")

    # ── 14. Premium ────────────────────────────────────────────
    print("\n[14/15] Premium (25,000) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.Premium").fetchone()[0]
    if existing == 0:
        prem_rows = []
        prem_id   = 1
        pol_eff_d = {r[0]: r[1] for r in cur.execute(
            "SELECT POL_NO, EFF_DT FROM legacy.PolicyMaster").fetchall()}
        pol_exp_d = {r[0]: r[1] for r in cur.execute(
            "SELECT POL_NO, EXP_DT FROM legacy.PolicyMaster").fetchall()}

        sample_cvgs2 = random.sample(all_cvg_ids, min(25000, len(all_cvg_ids)))
        cvg_pol = {r[0]: r[1] for r in cur.execute(
            "SELECT CVG_ID, POL_NO FROM legacy.Coverage").fetchall()}

        for cid in sample_cvgs2:
            pno = cvg_pol.get(cid)
            eff = pol_eff_d.get(pno, datetime.date(2020, 1, 1))
            exp = pol_exp_d.get(pno, datetime.date(2021, 1, 1))
            wp  = round(prem_dist() / 5, 2)   # per-coverage premium
            ep  = round(wp * random.uniform(0.5, 1.0), 2)
            tax = round(wp * 0.02, 2)
            fee = round(random.uniform(10, 50), 2)
            prem_rows.append((
                prem_id, pno, cid, "BASE",
                eff, exp,
                wp, ep, wp,
                tax, fee,
                round(wp * random.uniform(0, 0.1), 2),
                round(wp * random.uniform(0, 0.05), 2),
            ))
            prem_id += 1
        batch_insert(cur,
            "INSERT INTO legacy.Premium "
            "(PREM_ID,POL_NO,CVG_ID,PREM_TYP_CD,EFF_DT,EXP_DT,"
            "WRTTN_PREM_AMT,ERND_PREM_AMT,BILL_PREM_AMT,"
            "TAX_AMT,FEE_AMT,SURCH_AMT,DISC_AMT) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            prem_rows)
    else:
        print(f"  {existing} premiums already exist — skipped.")

    # ── 15. PolicyNotes ────────────────────────────────────────
    print("\n[15/15] PolicyNotes (10,000) ...")
    existing = cur.execute("SELECT COUNT(*) FROM legacy.PolicyNotes").fetchone()[0]
    if existing == 0:
        note_rows = []
        for nid in range(1, 10001):
            pno  = random.choice(pol_nos)
            tmpl = random.choice(NOTE_TEMPLATES)
            note_rows.append((
                nid, pno,
                random.choice(NOTE_TYPES),
                tmpl.format(dt=fake.date(), n=fake.name()),
                fake.date_time_between(start_date="-5y", end_date="now"),
                f"USR{random.randint(1,20):03d}",
                "N",
            ))
        batch_insert(cur,
            "INSERT INTO legacy.PolicyNotes "
            "(NOTE_ID,POL_NO,NOTE_TYP_CD,NOTE_TXT,NOTE_DT,USER_ID,PRVT_FL) "
            "VALUES (?,?,?,?,?,?,?)",
            note_rows)
    else:
        print(f"  {existing} notes already exist — skipped.")

    # ── Simulation records export ──────────────────────────────
    print("\n[+] Generating simulation records ...")
    _generate_simulation_records(cur)

    con.close()
    print("\n✓ LegacyInsurance data generation complete!")
    print("  Run scripts/setup_legacy_connection.py to register in Data Workbench.")

def _generate_simulation_records(cur):
    """Export 100 sample input→expected transformation records."""
    rows = cur.execute("""
        SELECT TOP 100
            pm.POL_NO, pm.POL_STATUS, pm.LOB_CD, pm.STATE_CD,
            pm.ANN_PREM_AMT,
            ni.INSD_NM, ni.DOB_DT, ni.GNDR_CD,
            a.ADDR_LN1, a.CITY_NM, a.ST_CD, a.ZIP_CD
        FROM legacy.PolicyMaster pm
        LEFT JOIN legacy.NamedInsured ni ON pm.POL_NO = ni.POL_NO AND ni.INSD_TYP_CD = 'PRI'
        LEFT JOIN legacy.Address a       ON pm.POL_NO = a.POL_NO  AND a.ADDR_TYP_CD  = 'MAIL'
        ORDER BY pm.POL_NO
    """).fetchall()

    STATUS_MAP = {"A":"ACT","C":"CAN","P":"PENDING","E":"EXPIRED","R":"REINSTATE"}
    LOB_MAP    = {"AUTO":"Private Passenger Auto","HOME":"Homeowners",
                  "GL":"General Liability","WC":"Workers Compensation","COMM_AUTO":"Commercial Auto"}
    STATE_MAP  = {"TX":"Texas","CA":"California","FL":"Florida","NY":"New York","AZ":"Arizona"}

    records = []
    for r in rows:
        pno, sts, lob, st, prem, nm, dob, gndr, addr1, city, st2, zipcd = r
        records.append({
            "input": {
                "POL_NO":     pno,
                "POL_STATUS": sts,
                "LOB_CD":     lob,
                "STATE_CD":   st,
                "ANN_PREM_AMT": float(prem or 0),
                "INSD_NM":    nm or "",
                "GNDR_CD":    gndr or "",
            },
            "expected": {
                "PolicyNumber":     pno,
                "PolicyStatus":     STATUS_MAP.get(sts, sts),
                "LineOfBusiness":   LOB_MAP.get(lob, lob),
                "State":            STATE_MAP.get(st, st),
                "Tier":             "Gold" if (prem or 0) > 10000 else "Standard",
                "InsuredName":      nm or "",
            }
        })

    out = Path(__file__).parent.parent / "samples" / "legacy_simulation_records.json"
    out.parent.mkdir(exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, default=str)
    print(f"  Simulation records saved to {out}")

def _drop_tables(cur):
    """Drop all legacy tables in FK-safe order."""
    tables = [
        "PolicyNotes","Premium","CoverageDeductible","CoverageLimit","Coverage",
        "Driver","Vehicle","Location","Address","NamedInsured",
        "PolicyTransaction","PolicyTerm","PolicyMaster",
        "Producer","Agency",
        "RefDriverStatus","RefVehicleType","RefState","RefCoverageType","RefLOB","RefPolicyStatus",
    ]
    for t in tables:
        try:
            cur.execute(f"IF OBJECT_ID('legacy.{t}', 'U') IS NOT NULL DROP TABLE legacy.{t}")
            print(f"  Dropped legacy.{t}")
        except Exception as e:
            print(f"  Warning dropping {t}: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate LegacyInsurance demo data")
    parser.add_argument("--reset", action="store_true",
                        help="Drop and recreate all tables before generating")
    args = parser.parse_args()
    run(reset=args.reset)
