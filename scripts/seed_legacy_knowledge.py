"""
seed_legacy_knowledge.py
=========================
Seeds 100 Knowledge Hub articles about the LegacyInsurance system
into Data Workbench's SAI Knowledge Hub.

Usage:
    .venv\\Scripts\\python.exe scripts/seed_legacy_knowledge.py

Articles cover:
  - Legacy system overview (15)
  - Source table documentation (20)
  - Duck Creek mapping logic (20)
  - Conversion issues & troubleshooting (20)
  - Business rules documentation (15)
  - Reconciliation & validation (10)
"""
from __future__ import annotations
import os, sys, json, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

import urllib.request, urllib.error

API_BASE  = "http://localhost:8000/api"
ADMIN_USR = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PWD = os.getenv("ADMIN_PASSWORD", "clarity2024")

def _req(method: str, path: str, payload=None, token: str | None = None, timeout: int = 120):
    url  = f"{API_BASE}{path}"
    data = json.dumps(payload).encode() if payload else None
    req  = urllib.request.Request(url, data=data, method=method,
           headers={"Content-Type":"application/json",
                    **({"Authorization":f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode()[:200]}")
        return None
    except Exception as e:
        print(f"  Request failed: {e}")
        return None

def login() -> str:
    r = _req("POST", "/auth/login", {"username": ADMIN_USR, "password": ADMIN_PWD})
    if not r:
        print("ERROR: Login failed.")
        sys.exit(1)
    return r["access_token"]

def post_article(article: dict, token: str) -> bool:
    # Truncate raw_content to avoid very slow LLM processing
    if len(article.get("raw_content", "")) > 2000:
        article = dict(article)
        article["raw_content"] = article["raw_content"][:2000].strip()
    r = _req("POST", "/knowledge/process", article, token, timeout=120)
    return r is not None

# ═══════════════════════════════════════════════════════════════
# Knowledge Articles
# ═══════════════════════════════════════════════════════════════

ARTICLES = [

# ── Legacy System Overview (15) ─────────────────────────────────────────────

{"title": "LegacyInsurance Database — System Overview",
 "type": "Process", "system": "General",
 "tags": ["LegacyInsurance","Overview","Architecture","SourceSystem"],
 "raw_content": """
LegacyInsurance is a 20-year-old SQL Server insurance policy administration system (PAS)
running on the legacy schema. It stores all core insurance data for Property & Casualty (P&C) lines
including Auto, Homeowners, General Liability, Workers Compensation, and Commercial Auto.

The system was originally deployed in 2005 and has undergone multiple enhancements but retains
its original naming conventions: underscore-delimited 4-8 character abbreviations (POL_NO, LOB_CD,
EFF_DT, ANN_PREM_AMT) reflecting COBOL-era data modeling principles.

Key characteristics:
- 21 tables organized in the legacy schema
- All policy data normalized to 3NF
- Dates stored as DATE (ANSI) type
- Dollar amounts as DECIMAL(12,2)
- Status/type codes are 1-5 character abbreviations requiring lookup translation
- No timestamps on most records — only ENTRY_DT and LAST_UPD_DT

The system supports 5,000+ active policies across 5 lines of business and serves as the
source for the Duck Creek Technologies policy migration project.
"""},

{"title": "LegacyInsurance Naming Conventions Reference Guide",
 "type": "Process", "system": "General",
 "tags": ["LegacyInsurance","NamingConventions","LegacyCode"],
 "raw_content": """
LegacyInsurance uses abbreviated legacy naming conventions developed in the early 2000s.

Common abbreviations:
  POL = Policy
  NO = Number/Identifier
  CD = Code
  DT = Date
  FL = Flag (Y/N)
  AMT = Amount
  NM = Name
  STS = Status
  TYP = Type
  CVG = Coverage
  PREM = Premium
  INSD = Insured
  AGCY = Agency
  PROD = Producer
  VEH = Vehicle
  DRVR = Driver
  LOC = Location
  ADDR = Address
  ANN = Annual
  EFF = Effective
  EXP = Expiration
  WRTTN = Written
  ERND = Earned
  BILL = Billed

All column names follow the pattern: ENTITY_ATTRIBUTE_TYPE
Examples: POL_STATUS (Policy Status Code), ANN_PREM_AMT (Annual Premium Amount)

When mapping to Duck Creek, translate to PascalCase full words:
  POL_NO → PolicyNumber
  LOB_CD → LineOfBusiness
  EFF_DT → EffectiveDate
  ANN_PREM_AMT → AnnualPremium
"""},

{"title": "Policy Status Lifecycle in LegacyInsurance",
 "type": "Process", "system": "General",
 "tags": ["PolicyStatus","Lifecycle","POL_STATUS","Conversion"],
 "raw_content": """
The POL_STATUS field in PolicyMaster uses single-character codes to represent the full
policy lifecycle. These must be translated to Duck Creek status codes during conversion.

Status Code Reference:
  A = Active        → Maps to: ACT
  C = Cancelled     → Maps to: CAN
  P = Pending       → Maps to: PENDING (awaiting underwriter approval)
  E = Expired       → Maps to: EXPIRED (term ended, not renewed)
  R = Reinstated    → Maps to: REINSTATE (previously cancelled, brought back)

Distribution in LegacyInsurance:
  Active:      70% of all policies
  Cancelled:   15%
  Pending:      5%
  Expired:      7%
  Reinstated:   3%

Key business rules:
- Cancelled policies (C) must have a CANCEL_DT populated
- Cancelled policies should have CANCEL_RSN_CD: NP (Non-Payment), NPS (Non-Payment Start), OT (Other)
- Expired policies are included in history but should NOT be sent to Duck Creek as active
- Reinstated policies require documentation in PolicyNotes (NOTE_TYP_CD = UNDW)
- Pending policies may need manual underwriter review before activation

For Duck Creek conversion: Only status A and R policies should be attached as active policies.
C and E policies should be sent as historical records only.
"""},

{"title": "Line of Business (LOB_CD) Reference",
 "type": "Process", "system": "General",
 "tags": ["LOB","LineOfBusiness","LOB_CD","Coverage"],
 "raw_content": """
The LOB_CD field in PolicyMaster identifies the line of insurance business.
Five lines are active in LegacyInsurance:

  AUTO      → Private Passenger Auto (40% of policies)
  HOME      → Homeowners (25%)
  GL        → General Liability (15%)
  WC        → Workers Compensation (10%)
  COMM_AUTO → Commercial Auto (10%)

Duck Creek mapping:
  AUTO      → Personal Lines → Auto
  HOME      → Personal Lines → Homeowners
  GL        → Commercial Lines → General Liability
  WC        → Commercial Lines → Workers Comp
  COMM_AUTO → Commercial Lines → Commercial Auto

Coverage codes vary by LOB:
  AUTO policies: BI, PD, COMP, COLL, MED, UM, UIM, RENT, TURO
  HOME policies: FIRE, THFT, WIND, LIAB
  GL policies:   BI, PD, LIAB
  WC policies:   WC (single coverage)
  COMM_AUTO:     BI, PD, COMP, COLL, LIAB

Important: Duck Creek routes Personal Lines and Commercial Lines to different processing queues.
Ensure LOB_CD is correctly translated before policy attach.
"""},

{"title": "Understanding the PolicyMaster Table",
 "type": "Process", "system": "DCT",
 "tags": ["PolicyMaster","CoreTable","Conversion","DDL"],
 "raw_content": """
PolicyMaster is the central table in LegacyInsurance and the primary source for the
Duck Creek Policy Attach process.

Primary Key: POL_NO (VARCHAR 20) — format: P followed by 5-digit number (P01001 - P06000)

Key fields and their Duck Creek equivalents:
  POL_NO        → PolicyNumber       (required, unique identifier)
  POL_STATUS    → PolicyStatus       (A/C/P/E/R → ACT/CAN/PENDING/EXPIRED/REINSTATE)
  LOB_CD        → LineOfBusiness     (AUTO/HOME/GL/WC/COMM_AUTO → full description)
  EFF_DT        → EffectiveDate      (DATE type, no time component)
  EXP_DT        → ExpirationDate     (always EFF_DT + 365 days for annual policies)
  STATE_CD      → StateCode          (2-char ANSI code → full state name)
  ANN_PREM_AMT  → AnnualPremium      (DECIMAL 12,2 — includes all surcharges)
  AGCY_CD       → AgencyCode         (FK to Agency table)
  PROD_CD       → ProducerCode       (FK to Producer table)
  TIER_CD       → PremiumTier        (GOLD/STD — derived from ANN_PREM_AMT)

Data quality issues to watch for:
  - Some older policies have NULL AGCY_CD (pre-agency tracking era)
  - CANCEL_DT may be NULL for Cancelled policies — data entry error
  - ANN_PREM_AMT of 0.00 indicates data entry error, not truly zero premium
  - EXP_DT = EFF_DT + 365 days (most policies), but some have non-standard terms
"""},

{"title": "Vehicle Data Quality and VIN Validation",
 "type": "Issue", "system": "General",
 "tags": ["Vehicle","VIN","DataQuality","Conversion"],
 "raw_content": """
The Vehicle table has several known data quality issues that affect Duck Creek policy attach.

VIN (Vehicle Identification Number) issues:
  - Standard: 17 characters, alphanumeric (no I, O, Q)
  - Legacy system accepts any 17-char string — no validation on entry
  - Approximately 2-3% of VINs have invalid check digits
  - Some older records have NULL VINs (pre-2005 data entry)
  - VINs starting with 1,2,3 = North American manufactured
  - VINs starting with J = Japanese manufactured

Remediation steps:
  1. Query: SELECT VEH_ID, VIN_NO FROM legacy.Vehicle WHERE LEN(VIN_NO) <> 17 OR VIN_NO IS NULL
  2. Cross-reference with DMV data if available
  3. For missing VINs, use 1J000000000000000 placeholder with manual review flag
  4. Duck Creek rejects policy attach if VIN is null — must be resolved before cutover

Vehicle year issues:
  - Some records have VEH_YR = 9999 (data entry error) — should be excluded
  - Very old vehicles (VEH_YR < 1970) may not have NADA values for COMP/COLL rating

License plate issues:
  - LIC_PLTE_NO format varies by state — no standardization applied
  - Some records have ALL CAPS, some mixed case
  - Normalize to UPPER CASE before Duck Creek attach
"""},

{"title": "Coverage Code Reference and Mapping Guide",
 "type": "Process", "system": "DCT",
 "tags": ["CoverageCode","CVG_CD","Mapping","DuckCreek"],
 "raw_content": """
Coverage codes in LegacyInsurance use short abbreviations that must be translated to
Duck Creek coverage type names.

Complete mapping:
  BI    → Bodily Injury Liability    (required for AUTO)
  PD    → Property Damage Liability  (required for AUTO)
  COMP  → Comprehensive (OTC)        (optional — Other Than Collision)
  COLL  → Collision                  (optional)
  MED   → Medical Payments           (optional — PA or FL required)
  UM    → Uninsured Motorist         (required in most states)
  UIM   → Underinsured Motorist      (required in some states)
  PIP   → Personal Injury Protection (required in no-fault states: FL, MI, NY, NJ)
  TURO  → Towing and Road Service    (optional endorsement)
  RENT  → Rental Reimbursement       (optional endorsement)
  FIRE  → Fire                       (HOME coverage)
  THFT  → Theft                      (HOME coverage)
  WIND  → Windstorm/Hail             (HOME coverage — separate in FL)
  LIAB  → General Liability          (HOME and GL)
  WC    → Workers Compensation       (WC line only)

Common conversion issues:
  - Some legacy records use non-standard codes (BL for BI, PRPD for PD)
  - Query for unexpected codes: SELECT DISTINCT CVG_CD FROM legacy.Coverage
  - COMP without COLL is valid (comprehensive only package)
  - BI limits are always stored separately from PD limits in CoverageLimit
"""},

{"title": "Premium Tier Classification Logic",
 "type": "Process", "system": "DCT",
 "tags": ["PremiumTier","BusinessRule","Gold","Standard"],
 "raw_content": """
The Premium Tier classification is a key business rule applied during Duck Creek conversion.
It is not stored as a verified value in the legacy system — the TIER_CD column is derived
and may not always be populated or accurate.

Business Rule:
  IF ANN_PREM_AMT > 10,000 THEN Tier = 'Gold'
  ELSE Tier = 'Standard'

Extended rule (Platinum tier):
  IF ANN_PREM_AMT > 20,000 AND POL_STATUS = 'A' THEN Tier = 'Platinum'
  ELSE IF ANN_PREM_AMT > 10,000 THEN Tier = 'Gold'
  ELSE Tier = 'Standard'

Distribution in LegacyInsurance:
  Gold policies:     approximately 8% of active policies
  Platinum policies: approximately 2% of active policies
  Standard:          90% of active policies

Duck Creek mapping:
  Gold → DuckCreek PolicyClass = PREM (Premium)
  Standard → DuckCreek PolicyClass = STD (Standard)

Underwriting significance:
  Gold/Platinum tier policies require senior underwriter approval for major changes.
  Tier influences commission calculation and service level agreements (SLA).

Validation query:
  SELECT CASE WHEN ANN_PREM_AMT > 10000 THEN 'Gold' ELSE 'Standard' END AS Tier,
         COUNT(*), SUM(ANN_PREM_AMT)
  FROM legacy.PolicyMaster WHERE POL_STATUS = 'A'
  GROUP BY CASE WHEN ANN_PREM_AMT > 10000 THEN 'Gold' ELSE 'Standard' END;
"""},

{"title": "Duck Creek Policy Attach Process Overview",
 "type": "Process", "system": "DCT",
 "tags": ["DuckCreek","PolicyAttach","ConversionProcess"],
 "raw_content": """
The Duck Creek Policy Attach process is the primary conversion mechanism for migrating
LegacyInsurance policies to Duck Creek Technologies platform.

Process steps:
1. Extract: Query LegacyInsurance source tables using the JOIN-aware SQL query
2. Transform: Apply 300 transformation rules (field mappings + lookup translations + business rules)
3. Validate: Run 50 validation checks to ensure data quality
4. Generate XML: Create Policy Attach XML in Duck Creek format
5. Dispatch: Send XML to Duck Creek API endpoint

Policy Attach XML structure:
  <PolicyAttach>
    <Policy>          ← From PolicyMaster
    <NamedInsured>    ← From NamedInsured (primary insured only)
    <Address>         ← From Address (mailing address)
    <Vehicles>        ← From Vehicle (all active vehicles)
    <Drivers>         ← From Driver (all non-excluded drivers)
    <Coverages>       ← From Coverage + CoverageLimit + CoverageDeductible
    <Premium>         ← From Premium (written premium totals)
  </PolicyAttach>

Key transformation requirements:
  - POL_STATUS must be translated: A→ACT, C→CAN, P→PENDING
  - LOB_CD must be translated: AUTO→Private Passenger Auto, HOME→Homeowners
  - All state codes must be expanded: TX→Texas, CA→California
  - ANN_PREM_AMT > 10000 triggers Gold tier classification
  - Excluded drivers (DRVR_STATUS_CD = EXC) should be omitted from attach

Performance notes:
  - Average of 3.5 vehicles per AUTO policy
  - Average of 2.5 drivers per AUTO policy
  - Average of 5 coverage lines per policy
  - Expect ~17,500 vehicle records and ~12,500 driver records for full active portfolio
"""},

{"title": "Common Data Quality Issues in LegacyInsurance",
 "type": "Issue", "system": "General",
 "tags": ["DataQuality","Issues","Conversion","Troubleshooting"],
 "raw_content": """
Before executing the Duck Creek conversion, these known data quality issues must be resolved:

1. Zero Premium Policies
   - Issue: Some policies have ANN_PREM_AMT = 0.00 (data entry errors)
   - Count: ~15-20 policies affected
   - Resolution: Manual premium lookup and update
   - Query: SELECT POL_NO FROM legacy.PolicyMaster WHERE ANN_PREM_AMT = 0

2. Missing Named Insured
   - Issue: ~5 policies lack a NamedInsured record
   - Resolution: Check paper files, enter manually before conversion
   - Query: SELECT pm.POL_NO FROM legacy.PolicyMaster pm WHERE NOT EXISTS
             (SELECT 1 FROM legacy.NamedInsured ni WHERE ni.POL_NO = pm.POL_NO)

3. Invalid VINs
   - Issue: ~150 vehicles have VINs that are not 17 characters
   - Resolution: Obtain correct VINs from DMV or vehicle registration
   - Query: SELECT VEH_ID, VIN_NO FROM legacy.Vehicle WHERE LEN(ISNULL(VIN_NO,'')) <> 17

4. Duplicate Coverage Records
   - Issue: Some policies have duplicate CVG_CD entries for the same vehicle
   - Cause: System allowed re-adding coverages without checking for duplicates
   - Resolution: Keep most recent entry, archive duplicates
   - Query: SELECT CVG_ID, POL_NO, VEH_ID, CVG_CD, COUNT(*) FROM legacy.Coverage
             GROUP BY POL_NO, VEH_ID, CVG_CD HAVING COUNT(*) > 1

5. Date Format Issues
   - Issue: Some DT fields have stored incorrect values (1900-01-01, 9999-12-31)
   - These are legacy defaults for NULL handling in the original system
   - Resolution: Treat 1900-01-01 as NULL; 9999-12-31 as NULL/open-ended

6. Missing Addresses
   - Issue: ~30 policies lack any Address record
   - Resolution: Contact agent for mailing address before cutover

7. Cancelled Without Cancellation Date
   - Issue: Some C-status policies have NULL CANCEL_DT
   - Resolution: Default to EFF_DT + 30 days for date estimation
"""},

{"title": "Agent and Producer Data Conversion",
 "type": "Process", "system": "DCT",
 "tags": ["Agency","Producer","Conversion","Channel"],
 "raw_content": """
Agency and Producer records in LegacyInsurance must be verified and mapped to Duck Creek
agency management before policy conversion begins.

Agency table:
  - 100 active agencies in AGCY_CD format (AGY0001 - AGY0100)
  - Types: IND (Independent), CAPT (Captive), DRCT (Direct)
  - Commission rates: 8%-15% standard range
  - Agencies must exist in Duck Creek before policies can be attached

Producer table:
  - 300 producers linked to agencies
  - Producer codes format: PRD00001 - PRD00300
  - Each producer has state license number and expiration date
  - WARNING: Check for expired licenses before cutover

Duck Creek pre-requisites:
  1. All Agency codes must be pre-loaded in Duck Creek agency table
  2. All Producer codes must be linked to their Duck Creek agent IDs
  3. Agency/Producer cross-reference table must be validated
  4. Commission rates should be verified against current contracts

Pre-conversion validation:
  - Select producers with expired licenses:
    SELECT PROD_CD, PROD_NM, LIC_EXP_DT FROM legacy.Producer
    WHERE LIC_EXP_DT < GETDATE() AND ACTV_FL = 'Y'
"""},

{"title": "Reconciliation After Conversion — Policy Attach Validation",
 "type": "Process", "system": "General",
 "tags": ["Reconciliation","Validation","PostConversion","Audit"],
 "raw_content": """
After Duck Creek Policy Attach completes, run these reconciliation queries to validate
the conversion was successful.

Level 1 — Count Reconciliation:
  Source (LegacyInsurance):
    SELECT COUNT(*) AS SourcePolicies FROM legacy.PolicyMaster WHERE POL_STATUS = 'A'
  Target (Duck Creek):
    SELECT COUNT(*) AS TargetPolicies FROM DCT.dbo.Policy WHERE PolicyStatus = 'ACT'
  Expected: Source count should equal Target count ± 0.1%

Level 2 — Premium Reconciliation:
  Source:
    SELECT SUM(ANN_PREM_AMT) AS SourcePremium FROM legacy.PolicyMaster WHERE POL_STATUS = 'A'
  Target:
    SELECT SUM(AnnualPremium) AS TargetPremium FROM DCT.dbo.Policy WHERE PolicyStatus = 'ACT'
  Expected: Totals should match ± $100 (rounding differences)

Level 3 — Vehicle Count:
  Source:
    SELECT COUNT(*) FROM legacy.Vehicle v
    JOIN legacy.PolicyMaster pm ON v.POL_NO = pm.POL_NO
    WHERE pm.POL_STATUS = 'A'
  Target: SELECT COUNT(*) FROM DCT.dbo.Vehicle WHERE PolicyStatus = 'ACT'

Level 4 — Coverage Count by Type:
  Source:
    SELECT CVG_CD, COUNT(*) FROM legacy.Coverage c
    JOIN legacy.PolicyMaster pm ON c.POL_NO = pm.POL_NO
    WHERE pm.POL_STATUS = 'A' AND c.CVG_STS_CD = 'A'
    GROUP BY CVG_CD
  Compare against Duck Creek coverage counts by type.

Acceptable variance thresholds:
  Policy counts: ±0.1% (near-zero tolerance)
  Premium totals: ±0.5% ($50 per $10,000)
  Vehicle counts: ±0.5%
  Coverage counts: ±1% (some exclusions expected)
"""},

{"title": "SQL Query to Extract Active Policies for Duck Creek Attach",
 "type": "Process", "system": "DCT",
 "tags": ["SQL","Query","PolicyAttach","Extract"],
 "raw_content": """
Use this query in Data Workbench SQL Agent to extract all data needed for Duck Creek Policy Attach.
This is the primary query used by the Agent Pipeline for Auto policies.

Full Policy Attach Query (Auto LOB):
  SELECT
      pm.POL_NO                AS PolicyNumber,
      pm.POL_STATUS            AS PolicyStatusCode,
      pm.LOB_CD                AS LineOfBusinessCode,
      pm.EFF_DT                AS EffectiveDate,
      pm.EXP_DT                AS ExpirationDate,
      pm.STATE_CD              AS StateCode,
      pm.ANN_PREM_AMT          AS AnnualPremium,
      pm.AGCY_CD               AS AgencyCode,
      pm.PROD_CD               AS ProducerCode,
      ni.INSD_NM               AS InsuredName,
      ni.INSD_FRST_NM          AS InsuredFirstName,
      ni.INSD_LST_NM           AS InsuredLastName,
      ni.DOB_DT                AS DateOfBirth,
      ni.GNDR_CD               AS GenderCode,
      ni.MARITAL_STS_CD        AS MaritalStatusCode,
      a.ADDR_LN1               AS AddressLine1,
      a.CITY_NM                AS City,
      a.ST_CD                  AS AddressState,
      a.ZIP_CD                 AS ZipCode
  FROM legacy.PolicyMaster pm
  LEFT JOIN legacy.NamedInsured ni ON pm.POL_NO = ni.POL_NO AND ni.INSD_TYP_CD = 'PRI'
  LEFT JOIN legacy.Address a       ON pm.POL_NO = a.POL_NO  AND a.ADDR_TYP_CD  = 'MAIL'
  WHERE pm.POL_STATUS IN ('A', 'R')
    AND pm.LOB_CD = 'AUTO'
  ORDER BY pm.POL_NO;

Note: Vehicles, Drivers, and Coverages are extracted in separate queries and joined
during XML generation using the POL_NO identifier column.
"""},

{"title": "Premium Calculation Rules in LegacyInsurance",
 "type": "Process", "system": "General",
 "tags": ["Premium","Calculation","Business Rules","PremiumTier"],
 "raw_content": """
Premium in LegacyInsurance is stored across two tables: PolicyMaster (annual total)
and Premium (per-coverage breakdown).

PolicyMaster.ANN_PREM_AMT:
  - Total annual written premium for the policy
  - Includes base premium + surcharges - discounts + taxes + fees
  - This is the primary field for reporting and tier classification
  - Gold tier threshold: > $10,000 (approximately 8% of active policies)

Premium table breakdown:
  WRTTN_PREM_AMT = Written premium (full term amount)
  ERND_PREM_AMT  = Earned premium (pro-rata for current period)
  BILL_PREM_AMT  = Billed amount (may differ from written due to payment plans)
  TAX_AMT        = State premium tax (typically 2-3% of written)
  FEE_AMT        = Policy fee ($25-$75 flat fee)
  SURCH_AMT      = Surcharge (SR22, young driver, high-risk surcharges)
  DISC_AMT       = Discount (multi-policy, good driver, loyalty discounts)

Net premium formula:
  BILL_PREM_AMT = WRTTN_PREM_AMT + TAX_AMT + FEE_AMT + SURCH_AMT - DISC_AMT

Duck Creek premium attach:
  Map WRTTN_PREM_AMT → WrittenPremium
  Map ERND_PREM_AMT  → EarnedPremium
  Map TAX_AMT        → TaxAmount
  Combine FEE_AMT + SURCH_AMT → TotalFees
"""},

{"title": "Workers Compensation Special Handling",
 "type": "Process", "system": "DCT",
 "tags": ["WorkersComp","WC","SpecialHandling","Conversion"],
 "raw_content": """
Workers Compensation (WC) policies in LegacyInsurance require special handling during
Duck Creek conversion.

Key differences from other LOBs:
  - WC has only one coverage code: WC (no BI, PD, COLL, COMP)
  - WC policies do not have Vehicle records
  - WC policies do not have Driver records
  - WC policies have Location records (work site locations)
  - Premium is based on payroll, not vehicles

WC table usage:
  PolicyMaster.LOB_CD = 'WC'
  Coverage.CVG_CD = 'WC' (single coverage per location)
  Location is used instead of Vehicle for risk attachment
  CoverageLimit stores employer liability limits

WC-specific fields to map:
  PolicyMaster.ANN_PREM_AMT = Estimated annual premium (based on payroll estimate)
  Location.SQ_FT may represent employee count (legacy workaround)
  PolicyNotes (NOTE_TYP_CD = 'UNDW') often contains payroll class codes

Duck Creek WC routing:
  WC policies route to Commercial Lines → Workers Comp specialty queue
  Require state-specific rate filings
  Claims reserving handled separately from personal lines

Validation:
  WC policies must NOT have Vehicle or Driver records
  SELECT pm.POL_NO FROM legacy.PolicyMaster pm
  WHERE pm.LOB_CD = 'WC'
  AND EXISTS (SELECT 1 FROM legacy.Vehicle v WHERE v.POL_NO = pm.POL_NO)
  -- Should return 0 rows
"""},

# ── Source Table Documentation (20 articles) ────────────────────────────────

{"title": "PolicyTerm Table — Term and Renewal Tracking",
 "type": "Process", "system": "General",
 "tags": ["PolicyTerm","Renewal","TermTracking","Conversion"],
 "raw_content": """
The PolicyTerm table tracks each policy term period and the renewal chain.

Key fields:
  TERM_ID:       Surrogate key (auto-increment INT)
  POL_NO:        FK to PolicyMaster
  TERM_NO:       Sequence number (1 for new business, 2 for first renewal, etc.)
  TERM_EFF_DT:   Term start date
  TERM_EXP_DT:   Term end date (TERM_EFF_DT + 365 days for annual)
  PRIOR_POL_NO:  Previous term's policy number (same if renewal, NULL if new business)
  TERM_PREM_AMT: Premium for this specific term

Renewal detection logic:
  IF PRIOR_POL_NO IS NOT NULL → This is a renewal term
  IF PRIOR_POL_NO IS NULL AND TERM_NO = 1 → This is a new business policy

Conversion note:
  Duck Creek's prior policy linkage field maps to PRIOR_POL_NO
  Term sequence tracking maps TERM_NO to Duck Creek's TermNumber
  Most policies have 1-3 terms (new business + 1-2 renewals)
"""},

{"title": "PolicyTransaction Table — Change History",
 "type": "Process", "system": "General",
 "tags": ["PolicyTransaction","ChangeHistory","Endorsements","Audit"],
 "raw_content": """
PolicyTransaction stores every change made to a policy since inception.
This is the audit trail and must be preserved during conversion.

Transaction type codes:
  NB = New Business (initial policy issuance)
  RN = Renewal (term renewal processed)
  EN = Endorsement (mid-term change)
  CN = Cancellation (policy cancelled)
  RE = Reinstatement (policy restored after cancellation)
  CH = Mid-Term Change (name/address update without premium change)

Key conversion decisions:
  1. Transaction history should be migrated for audit purposes
  2. Duck Creek equivalent is the Transaction table in policy history
  3. CHNG_PREM_AMT shows premium impact of each change
  4. Negative CHNG_PREM_AMT = premium decrease (credit to insured)

Warning: Many legacy systems have orphaned transactions (POL_NO references
deleted policies). Run validation before migration:
  SELECT t.TRANS_ID FROM legacy.PolicyTransaction t
  WHERE NOT EXISTS (SELECT 1 FROM legacy.PolicyMaster pm WHERE pm.POL_NO = t.POL_NO)
"""},

{"title": "Address Table — Structure and Address Types",
 "type": "Process", "system": "General",
 "tags": ["Address","ADDR_TYP_CD","Mailing","Risk","Billing"],
 "raw_content": """
The Address table stores multiple address types per policy. Duck Creek requires
specific address type mapping.

Address type codes:
  MAIL = Mailing Address (required for all policies — Duck Creek primary address)
  RISK = Risk Location (where insured property is located — HOME/LOC policies)
  BILL = Billing Address (separate from mailing — 30% of policies)
  GAR  = Garaging Address (where vehicle is garaged — usually same as mailing)

Duck Creek address mapping:
  MAIL → Policy.MailingAddress (required, always use MAIL type for primary)
  RISK → InsuredObject.RiskAddress (for HOME, LOC risks)
  BILL → Policy.BillingAddress (if different from mailing)

Data quality notes:
  ~30 policies have no MAIL address — must be resolved before cutover
  ZIP_CD may be 5 or 9 digit format (use first 5 digits for USPS standardization)
  ST_CD must match RefState codes (2-char ANSI state abbreviations)
  CITY_NM is not standardized — may need USPS address validation

Primary address selection query:
  SELECT * FROM legacy.Address
  WHERE POL_NO = 'P01001' AND ADDR_TYP_CD = 'MAIL'
"""},

{"title": "Driver Table — Driver Records and Risk Assessment",
 "type": "Process", "system": "DCT",
 "tags": ["Driver","RiskAssessment","DriverStatus","SR22"],
 "raw_content": """
The Driver table contains all drivers associated with an auto policy.

Driver Status codes:
  PRM  = Primary Driver (rated, most frequent operator)
  OCC  = Occasional Driver (rated, less frequent)
  EXC  = Excluded Driver (NOT rated — excluded by insured request, signed form required)
  LIST = Listed Driver (on policy but not rated)

Critical rule: Excluded drivers (DRVR_STATUS_CD = 'EXC') should NOT be included
in the Duck Creek driver attach. These drivers have signed exclusion forms and
are explicitly not covered. Including them in Duck Creek would incorrectly rate them.

Risk indicators:
  ACCIDENTS_CNT > 2 → High Risk Driver (surcharge applies)
  VIOLATIONS_CNT > 0 → MVR Points assessed
  SR22_FL = 'Y' → SR22 financial responsibility filing required
  PTS_TOTAL → Total driver record points (accidents × 2 + violations)

Age derivation:
  Driver age must be calculated from DOB_DT:
  Age = DATEDIFF(year, DOB_DT, GETDATE())
  Age < 25 → Young Driver classification (higher rates)
  Age > 70 → Senior Driver flag (review for competency)

Duck Creek driver mapping:
  DRVR_STATUS_CD → DriverStatus (PRM→Primary, OCC→Occasional, LIST→Listed)
  LIC_NO + LIC_ST_CD → LicenseNumber + LicenseState
  DOB_DT → DateOfBirth
  ACCIDENTS_CNT → AccidentCount
  SR22_FL → SR22Required
"""},

{"title": "Coverage, CoverageLimit, and CoverageDeductible — Relationship",
 "type": "Process", "system": "DCT",
 "tags": ["Coverage","Limits","Deductibles","Structure"],
 "raw_content": """
Three tables work together to define complete coverage terms:

1. Coverage (parent):
   CVG_ID, POL_NO, VEH_ID, CVG_CD, CVG_TYP_CD, EFF_DT, EXP_DT, CVG_STS_CD
   - One row per coverage per vehicle (for auto) or per location (for property)
   - CVG_STS_CD = 'A' means active coverage

2. CoverageLimit (child of Coverage):
   LMT_ID, CVG_ID, LMT_TYP_CD, PER_OCCUR_LMT, AGG_LMT, PER_PERSON_LMT
   - One row per limit type per coverage
   - Common split limit: 100,000 PER_PERSON / 300,000 PER_OCCUR for BI
   - Combined single limit (CSL): single PER_OCCUR_LMT value

3. CoverageDeductible (child of Coverage):
   DED_ID, CVG_ID, DED_TYP_CD, DED_AMT
   - FLAT type: fixed dollar deductible (e.g., $500)
   - PCT type: percentage of vehicle value (e.g., 2%)
   - WAIV type: waived (no deductible)

Duck Creek structure:
  CoverageCode + PerOccurrenceLimit + PerPersonLimit → BI/PD limits
  DeductibleAmount + DeductibleType → COMP/COLL deductibles
  AggregateLimit → GL/WC aggregate exposure

Join query:
  SELECT c.CVG_CD, cl.PER_OCCUR_LMT, cl.PER_PERSON_LMT, cd.DED_AMT
  FROM legacy.Coverage c
  LEFT JOIN legacy.CoverageLimit cl ON c.CVG_ID = cl.CVG_ID
  LEFT JOIN legacy.CoverageDeductible cd ON c.CVG_ID = cd.CVG_ID
  WHERE c.POL_NO = 'P01001' AND c.CVG_STS_CD = 'A'
"""},

{"title": "PolicyNotes — Underwriting Notes and Audit Trail",
 "type": "Process", "system": "General",
 "tags": ["PolicyNotes","Underwriting","Audit","Notes"],
 "raw_content": """
PolicyNotes stores free-text notes entered by agents, underwriters, and billing staff.
These are informational and not directly mapped to Duck Creek fields, but should be
migrated as policy comments/history.

Note type codes:
  GEN  = General (catch-all for miscellaneous notes)
  UNDW = Underwriting (underwriter observations, approval conditions)
  BILL = Billing (payment arrangements, billing issues)
  CLMS = Claims (claim references, loss notices)

Migration decision:
  - All UNDW notes should be migrated as underwriting comments in Duck Creek
  - GEN notes should be migrated as policy comments
  - BILL and CLMS notes are informational — review with business before migrating
  - Notes with PRVT_FL = 'Y' are confidential — require special handling

Duck Creek notes field:
  Map to Policy.PolicyComments or PolicyHistory.CommentText
  Preserve NOTE_DT and USER_ID for audit trail

Common note patterns to watch:
  Notes mentioning 'EXCLUDED' likely relate to excluded driver documentation
  Notes mentioning 'SR22' indicate state filing requirements
  Notes mentioning 'AUDIT' may indicate an open audit item
"""},

{"title": "RefState Table — All 50 States Plus DC",
 "type": "Process", "system": "General",
 "tags": ["RefState","StateCodes","Reference","Conversion"],
 "raw_content": """
The RefState table contains all 50 US states plus Washington DC (51 total records).
State codes are 2-character ANSI state abbreviations.

Top 5 states by policy volume in LegacyInsurance:
  TX = Texas          (30% of policies)
  CA = California     (25%)
  FL = Florida        (20%)
  NY = New York       (15%)
  AZ = Arizona        (10%)

State-specific conversion rules:
  TX → Texas:         UM coverage required by statute
  CA → California:    Minimum BI = 15,000/30,000; strict privacy rules
  FL → Florida:       PIP coverage required; no-fault state
  NY → New York:      No-fault state; PIP required; Supplemental Uninsured Motorist required
  AZ → Arizona:       UM rejection available (must document)

Duck Creek state code mapping:
  All 2-char codes map directly to Duck Creek StateCode field
  Duck Creek also stores the full state name in StateName field
  Use JOIN with RefState to get full name for StateName mapping

  SELECT r.ST_CD, r.ST_NM
  FROM legacy.RefState r
  ORDER BY r.ST_NM;
"""},

{"title": "Agency and Producer Commission Structure",
 "type": "Process", "system": "General",
 "tags": ["Agency","Commission","Producer","Channel"],
 "raw_content": """
LegacyInsurance uses three agency distribution channels:
  IND (Independent): Agent represents multiple carriers, earns 10-15% commission
  CAPT (Captive): Exclusive carrier representation, earns 8-12%
  DRCT (Direct): Carrier-employed staff, standard salary (no commission in system)

Commission calculation:
  Commission = ANN_PREM_AMT × (COMM_PCT / 100)
  Example: $3,000 premium × 10% = $300 commission

Commission fields in Agency:
  COMM_PCT stores the base commission rate
  Individual producer overrides are not tracked in legacy system
  Contingent/bonus commissions handled outside this system

Pre-conversion checklist for Agency/Producer:
  1. Verify all AGCY_CD values exist in Duck Creek agency master
  2. Confirm PROD_CD mappings to Duck Creek producer IDs
  3. Update producer licenses that have expired since last data entry
  4. Validate commission rates against current contracts

Query for agency production summary:
  SELECT a.AGCY_CD, a.AGCY_NM, a.AGCY_TYP_CD, a.COMM_PCT,
         COUNT(pm.POL_NO) AS PolicyCount,
         SUM(pm.ANN_PREM_AMT) AS TotalPremium,
         SUM(pm.ANN_PREM_AMT * a.COMM_PCT / 100) AS EstCommission
  FROM legacy.Agency a
  LEFT JOIN legacy.PolicyMaster pm ON a.AGCY_CD = pm.AGCY_CD AND pm.POL_STATUS = 'A'
  GROUP BY a.AGCY_CD, a.AGCY_NM, a.AGCY_TYP_CD, a.COMM_PCT
  ORDER BY TotalPremium DESC;
"""},

{"title": "Location Table — Property Risk Locations",
 "type": "Process", "system": "DCT",
 "tags": ["Location","PropertyRisk","HOME","GL"],
 "raw_content": """
The Location table stores risk locations for property-based lines of business
(HOME, GL, WC). This is the equivalent of the InsuredObject/RiskLocation in Duck Creek.

Usage by LOB:
  HOME: One location per policy (primary residence)
  GL:   One or more locations (business premises)
  WC:   One or more locations (work sites)
  AUTO: Not used (Vehicle table used instead)

Key fields:
  LOC_ID:      Surrogate key
  POL_NO:      Policy identifier
  LOC_NO:      Location sequence (1, 2, 3... for multiple locations)
  LOC_DESC:    Free-text description of location
  ADDR_ID:     FK to Address table (risk address)
  BLDG_TYP_CD: Building type (RES=Residential, COMM=Commercial)
  CNST_TYP_CD: Construction type (FR=Frame, MAS=Masonry, TF=Tinted/Frame)
  YR_BUILT:    Year structure was built (used for rating)
  SQ_FT:       Square footage of structure

Duck Creek mapping:
  LOC_ID + LOC_NO → InsuredObjectID + LocationSequence
  BLDG_TYP_CD → ConstructionClass (RES→1, COMM→5)
  YR_BUILT → YearBuilt
  SQ_FT → SquareFootage

Buildings over 50 years old (YR_BUILT < 1975) require inspection reports.
Historic buildings (YR_BUILT < 1960) require specialty underwriting review.
"""},

{"title": "Vehicle Table — Auto Risk Data Structure",
 "type": "Process", "system": "DCT",
 "tags": ["Vehicle","AutoRisk","VIN","Rating"],
 "raw_content": """
The Vehicle table stores all vehicles on AUTO and COMM_AUTO policies.

Vehicle type codes (VEH_TYP_CD):
  PP  = Private Passenger (sedan, coupe, hatchback)
  SUV = Sport Utility Vehicle
  TRK = Pickup Truck
  VAN = Minivan/Van
  MC  = Motorcycle
  RV  = Recreational Vehicle
  CTK = Commercial Truck (>10,000 GVW)
  BUS = Bus/Transit
  TRL = Trailer

Vehicle use codes (USE_CD):
  PL  = Pleasure Use (personal, weekend driving)
  BUS = Business Use (commute + business errands)
  FM  = Farm Use (agricultural purposes)
  CO  = Commercial Use (business delivery, for-hire)

Rating factors by use:
  PL  → base rate
  BUS → +15% surcharge (increased exposure)
  FM  → -5% discount (limited mileage, rural)
  CO  → +35% surcharge (commercial activity)

Annual mileage (ANN_MILEAGE) impacts base rate:
  < 7,500 miles → Low mileage discount
  7,500 - 15,000 → Standard rate
  > 25,000 miles → High mileage surcharge

Duck Creek vehicle mapping:
  VEH_YR / VEH_MK / VEH_MDL → Year/Make/Model (from ISO symbols)
  VIN_NO → VehicleIdentificationNumber (17 chars, validated)
  VEH_TYP_CD → VehicleTypeCode (translated to Duck Creek values)
  USE_CD → VehicleUse (translated PL→Personal, BUS→Business, CO→Commercial)
"""},

# ── Additional articles (abbreviated for seeding) ───────────────────────────

{"title": "Troubleshooting: Zero Count After Schema Collection",
 "type": "Issue", "system": "DCT",
 "tags": ["Troubleshooting","SchemaCollection","DataWorkbench"],
 "raw_content": """
If Admin > Collect Schema shows 0 tables discovered for LegacyInsurance connection:

1. Verify the connection is configured with schema_name = 'legacy'
   - Data Workbench queries sys.tables WHERE schema_id = SCHEMA_ID(schema_name)
   - If schema_name is left blank, it defaults to 'dbo' which has no tables

2. Test the connection first:
   - Connections > Test Connection should return "Connected successfully"
   - If it fails, check host (104.211.112.63,1433) and credentials (sa / Clarity@2026)

3. Verify SQL Server allows remote connections:
   - Firewall must allow port 1433 inbound
   - SQL Server must be configured for TCP/IP connections
   - SQL Browser service should be running for named instances

4. Check that the LegacyInsurance database exists:
   SELECT name FROM sys.databases WHERE name = 'LegacyInsurance'
   -- Should return 1 row

5. Check that the legacy schema exists:
   USE LegacyInsurance; SELECT SCHEMA_ID('legacy')
   -- Should return a non-null integer

6. Check table permissions:
   GRANT SELECT ON SCHEMA::legacy TO sa
   -- Grants sa read access to all legacy schema tables
"""},

{"title": "Troubleshooting: Agent Pipeline Fails with FK Error",
 "type": "Issue", "system": "DCT",
 "tags": ["Troubleshooting","AgentPipeline","ForeignKey","SQL"],
 "raw_content": """
If the Agent Pipeline (Mapper Agent) generates SQL with incorrect JOINs causing errors:

Common errors:
  "Multi-part identifier could not be bound" → Table alias issue in JOIN condition
  "Invalid object name 'legacy.Vehicle'" → Schema prefix missing or wrong
  "Ambiguous column name" → Same column name in multiple JOINs

Solutions:
1. Ensure Admin > Collect Schema was run AFTER establishing the LegacyInsurance connection
   - Without schema collection, FK graph is empty → falls back to flat single-table query

2. Check FK relationships were discovered:
   SELECT * FROM conversion_catalog_relations WHERE conn_id = <your_conn_id>
   - Should show ~20 FK relationships (Vehicle.POL_NO → PolicyMaster.POL_NO, etc.)

3. If using multi-table JOIN, ensure identifier column is set:
   - Set to: PolicyMaster.POL_NO (the primary linking key)
   - This tells the BFS algorithm which table to start from

4. Re-run Admin > Generate Embeddings after schema collection
   - Embeddings are used for field matching — stale embeddings cause wrong mappings

5. Try "Keep existing mappings" checkbox to prevent the mapper from regenerating SQL
   if mappings are already correct but SQL regeneration is causing issues
"""},

{"title": "Ask AI — Sample Questions for LegacyInsurance Demo",
 "type": "UseCase", "system": "General",
 "tags": ["AskAI","Demo","SampleQuestions","KnowledgeHub"],
 "raw_content": """
These are sample questions to demonstrate the Ask AI capability with LegacyInsurance context.
The Knowledge Hub has been pre-populated to answer all of these.

Policy Status Questions:
  Q: What does POL_STATUS = 'A' mean?
  A: 'A' means Active. Active policies are currently in-force and should be mapped to ACT in Duck Creek.

  Q: How should cancelled policies be handled in Duck Creek?
  A: Cancelled policies (POL_STATUS = 'C') should be sent as CAN status. They require CANCEL_DT to be populated.

Coverage Questions:
  Q: What is BI coverage in LegacyInsurance?
  A: BI is Bodily Injury Liability. It covers injury to third parties in an at-fault accident. Maps to 'Bodily Injury Liability' in Duck Creek.

  Q: What coverages are required for AUTO policies?
  A: Required coverages for AUTO are BI (Bodily Injury) and PD (Property Damage). UM (Uninsured Motorist) is required in Texas.

Premium Questions:
  Q: How is the Gold tier determined?
  A: Gold tier is assigned when ANN_PREM_AMT > $10,000. Approximately 8% of active policies qualify as Gold tier.

Data Quality Questions:
  Q: What are common VIN issues in the legacy system?
  A: Approximately 2-3% of VINs have invalid check digits. Some older records have NULL VINs. All VINs must be 17 characters for Duck Creek attach.

  Q: What does zero premium mean?
  A: A premium of $0.00 is a data entry error and should be corrected before conversion. These policies should not be sent to Duck Creek.

Conversion Process Questions:
  Q: What order should tables be extracted for policy attach?
  A: Start with PolicyMaster, then JOIN to NamedInsured, Address, Vehicle, Driver, Coverage, CoverageLimit, CoverageDeductible, and Premium.

  Q: Should excluded drivers be sent to Duck Creek?
  A: No. Drivers with DRVR_STATUS_CD = 'EXC' (Excluded) have signed exclusion forms and should NOT be included in the Duck Creek driver attach.
"""},

{"title": "State-Specific Insurance Requirements Affecting Conversion",
 "type": "Process", "system": "DCT",
 "tags": ["StateRequirements","Compliance","UM","PIP","NoFault"],
 "raw_content": """
Different states have mandatory coverage requirements that affect Duck Creek policy attach.

No-Fault States (PIP required):
  FL (Florida)    - PIP minimum $10,000 required; cannot reject
  NY (New York)   - PIP required; Supplemental SUM required
  MI (Michigan)   - Unlimited PIP available; $250K default
  NJ (New Jersey) - Basic/Standard PIP options

Uninsured Motorist (UM) requirements:
  TX (Texas)    - UM required; can reject in writing
  CA (California) - UM required; may stack
  FL (Florida)  - UM rejection available in writing
  NY (New York) - SUM required (Supplemental UM)

Minimum BI limits by state:
  TX:  25,000/50,000
  CA:  15,000/30,000 (increasing to 30,000/60,000 in 2025)
  FL:  10,000/20,000
  NY:  25,000/50,000
  AZ:  25,000/50,000

Conversion validation: For each policy, verify that the coverage limits in
CoverageLimit.PER_PERSON_LMT and PER_OCCUR_LMT meet the state minimums.
Policies with limits below state minimums must be flagged for manual review.

Query:
  SELECT pm.POL_NO, pm.STATE_CD, cl.PER_PERSON_LMT, cl.PER_OCCUR_LMT
  FROM legacy.PolicyMaster pm
  JOIN legacy.Coverage c ON pm.POL_NO = c.POL_NO AND c.CVG_CD = 'BI'
  JOIN legacy.CoverageLimit cl ON c.CVG_ID = cl.CVG_ID
  WHERE pm.STATE_CD = 'TX' AND cl.PER_PERSON_LMT < 25000;
"""},

{"title": "Duck Creek XML Schema — Policy Attach Field Mapping",
 "type": "Process", "system": "DCT",
 "tags": ["XML","PolicyAttach","FieldMapping","DuckCreek","Schema"],
 "raw_content": """
The Duck Creek Policy Attach XML must contain specific fields in the correct structure.
Below is the complete field mapping from LegacyInsurance to Duck Creek XML.

Policy Level:
  /Policy/PolicyNumber       ← PolicyMaster.POL_NO
  /Policy/PolicyStatus       ← PolicyMaster.POL_STATUS (translated)
  /Policy/LineOfBusiness     ← PolicyMaster.LOB_CD (translated)
  /Policy/EffectiveDate      ← PolicyMaster.EFF_DT
  /Policy/ExpirationDate     ← PolicyMaster.EXP_DT
  /Policy/StateCode          ← PolicyMaster.STATE_CD (2-char)
  /Policy/AnnualPremium      ← PolicyMaster.ANN_PREM_AMT
  /Policy/PremiumTier        ← Derived: Gold if > 10000, else Standard

NamedInsured Level:
  /NamedInsured/InsuredName  ← NamedInsured.INSD_NM
  /NamedInsured/DateOfBirth  ← NamedInsured.DOB_DT
  /NamedInsured/Gender       ← NamedInsured.GNDR_CD (M/F/U → Male/Female/Unknown)

Address Level:
  /Address/AddressLine1      ← Address.ADDR_LN1 (ADDR_TYP_CD = 'MAIL')
  /Address/City              ← Address.CITY_NM
  /Address/State             ← Address.ST_CD
  /Address/ZipCode           ← Address.ZIP_CD

Vehicle Level (repeated per vehicle):
  /Vehicles/Vehicle/VIN      ← Vehicle.VIN_NO (must be 17 chars)
  /Vehicles/Vehicle/Year     ← Vehicle.VEH_YR
  /Vehicles/Vehicle/Make     ← Vehicle.VEH_MK
  /Vehicles/Vehicle/Model    ← Vehicle.VEH_MDL

Coverage Level (repeated per active coverage):
  /Coverages/Coverage/CoverageCode  ← Coverage.CVG_CD (translated)
  /Coverages/Coverage/Limit         ← CoverageLimit.PER_OCCUR_LMT
  /Coverages/Coverage/Deductible    ← CoverageDeductible.DED_AMT
"""},
]

# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

def main():
    token = login()
    print(f"Seeding {len(ARTICLES)} Knowledge Hub articles ...")

    success = 0
    for i, article in enumerate(ARTICLES):
        ok = post_article(article, token)
        if ok:
            success += 1
            if (i + 1) % 10 == 0:
                print(f"  {i+1}/{len(ARTICLES)} articles seeded...")
        else:
            print(f"  WARNING: Failed to seed: {article['title'][:50]}")
        # Small delay to avoid overwhelming the embedding service
        time.sleep(0.2)

    print(f"\nDone. {success}/{len(ARTICLES)} articles seeded successfully.")
    print("  Background embedding will process automatically.")
    print("  Allow 2-5 minutes for embeddings to complete before testing Ask AI.")

if __name__ == "__main__":
    main()
