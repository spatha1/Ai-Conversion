# GL SAI Knowledge Base — Implementation Blueprint

**Platform:** SAI (Smart Architect Intelligence)  
**Domain:** General Ledger (GL) Operational Intelligence  
**Version:** 1.0  
**URL:** http://104.211.112.63

---

## Architecture Overview

```
Policy / Billing / Claims
    │
    ▼
ADF Pipelines  ──────────────────────── [Owner: Capricorn/Informatica]
    │
    ▼
Clarity Bronze
    │
    ▼
Clarity Silver
    │
    ▼
Canonical Views
    ├── V_POLICY_CANON
    ├── V_BILLING_CANON
    └── V_CLAIMS_CANON
    │
    ▼
GL Processing  ──────────────────────── [Owner: Aggne]
    ├── SP_GL_AU_FULL_LOAD → GL_DETAIL_AU → V_GL_DETAIL_AU → V_GL_AU_ALL
    └── SP_GL_NZ_FULL_LOAD → GL_DETAIL_NZ → V_GL_DETAIL_NZ → V_GL_NZ_ALL
    │
    ▼
Reconciliation ─────────────────────── [Owner: DB Team]
    │
    ▼
TRF Generation ─────────────────────── [Owner: Aggne]
    │
    ▼
Informatica APIs ───────────────────── [Owner: Capricorn/Informatica]
    │
    ▼
Downstream Financial Systems
```

---

## Team Ownership Summary

| Team | Systems Owned | Actions |
|---|---|---|
| **Capricorn / Informatica** | ADF Pipelines, Informatica middleware | Rerun ADF, trigger production recovery, submit TRF |
| **Aggne** | Policy B&C, Billing B&C, GL processing, TRF generation | Fix validations, rerun GL SPs, regenerate TRF |
| **DB Team** | Reconciliation, GL balancing, Earned Premium, monthly validation | Run recon queries, validate balances, approve close |
| **Snowflake Admin** | Snowflake execution layer | Rerun Snowflake processes, execute production recovery |

---

## KB Structure: 13 Categories × ~70 Atomic Entries

---

## Category 1 — Process Knowledge

> Type: `Process` | Purpose: Step-by-step workflows for SAI to guide operations

### Entry 1.1 — GL Daily Processing Workflow
- **Title:** `GL Daily Processing Workflow`
- **Type:** Process
- **System:** DCT
- **Tags:** GL, daily, workflow, processing
- **Purpose:** Defines the end-to-end daily GL processing sequence with decision gates
- **Content:**
  ```
  Step 1: ADF Pipelines complete (Capricorn validates)
  Step 2: Clarity Bronze populated from source systems
  Step 3: Clarity Silver transformed from Bronze
  Step 4: Canonical views built:
    - V_POLICY_CANON
    - V_BILLING_CANON
    - V_CLAIMS_CANON
  Step 5: B&C Validations pass (Aggne validates):
    - Policy B&C
    - Billing B&C
  Step 6: GL SPs execute:
    - SP_GL_AU_FULL_LOAD → GL_DETAIL_AU
    - SP_GL_NZ_FULL_LOAD → GL_DETAIL_NZ
  Step 7: GL Views refresh:
    - V_GL_DETAIL_AU, V_GL_AU_ALL
    - V_GL_DETAIL_NZ, V_GL_NZ_ALL
  Step 8: GL Balance Validation (DB Team)
  Step 9: Reconciliation (DB Team)
  Step 10: TRF Generation (Aggne)
  Step 11: TRF submitted to Informatica (Capricorn)

  STOP conditions at each step → see Operational Rules
  ```
- **Relationships:** → `ADF Pipeline Execution Sequence`, `Policy B&C Validation Rule`, `GL Dependency Model`

---

### Entry 1.2 — Monthly GLUE Processing Workflow
- **Title:** `Monthly GLUE Processing Workflow`
- **Type:** Process
- **Tags:** GL, monthly, GLUE, workflow
- **Content:**
  ```
  Trigger: Month-end date reached
  Step 1: Freeze daily processing
  Step 2: Run GLUE reconciliation extracts
  Step 3: Validate GLUE data completeness
  Step 4: Run Monthly B&C validations (Policy + Billing)
  Step 5: Execute GL full month load (AU + NZ)
  Step 6: Run Earned Premium (EM) validation (DB Team)
  Step 7: Monthly Reconciliation (DB Team)
  Step 8: GL Balancing sign-off (DB Team)
  Step 9: Generate monthly TRF (Aggne)
  Step 10: Submit TRF to Informatica (Capricorn)
  Step 11: Leadership sign-off → month close
  ```
- **Relationships:** → `Monthly Close Reconciliation Gate`, `Earned Premium Monthly Processing`, `Leadership Notification Framework`

---

### Entry 1.3 — Earned Premium Monthly Processing
- **Title:** `Earned Premium Monthly Processing`
- **Type:** Process
- **Tags:** GL, earned-premium, EM, monthly
- **Content:**
  ```
  Owner: DB Team
  Trigger: End of month, after GLUE run
  Step 1: Extract premium transactions from V_BILLING_CANON
  Step 2: Calculate earned premium per policy period
  Step 3: Validate against Policy source (V_POLICY_CANON)
  Step 4: Run EM validation queries
  Step 5: Post to GL_DETAIL_AU / GL_DETAIL_NZ
  Step 6: Reconcile EM total against expected
  STOP: If variance > tolerance → EM Failure Recovery
  ```
- **Relationships:** → `Earned Premium Validation Rule`, `EM Failure Recovery`, `Reconciliation Tolerance Rule`

---

### Entry 1.4 — TRF Generation Process
- **Title:** `TRF Generation Process`
- **Type:** Process
- **Tags:** TRF, GL, Informatica, generation
- **Content:**
  ```
  Owner: Aggne (generation) + Capricorn (submission)
  Step 1: Trigger after GL Reconciliation passes
  Step 2: Extract GL data from V_GL_AU_ALL + V_GL_NZ_ALL
  Step 3: Apply TRF transformation rules
  Step 4: Validate TRF row count and amounts
  Step 5: Decision gate:
    - Full match → submit to Informatica
    - Partial match → hold, escalate to leadership
    - Full mismatch → stop, alert leadership, invoke recovery
  Step 6: Informatica API submission (Capricorn)
  Step 7: Confirmation receipt from Informatica
  ```
- **Relationships:** → `Partial TRF Recovery`, `TRF Hold Rule: Full Mismatch`, `Leadership Notification Framework`

---

## Category 2 — Operational Rules

> Type: `OperationalRule` | Decision rules that govern GL operations

### Entry 2.1 — B&C Validation Must Pass Before GL
- **Title:** `GL Gate: B&C Validation Required`
- **Type:** OperationalRule
- **Severity:** CRITICAL
- **Trigger:** GL processing start requested
- **Action:** Block GL SP execution until Policy B&C AND Billing B&C both pass
- **Stop Condition:** If either B&C fails, do NOT execute SP_GL_AU_FULL_LOAD or SP_GL_NZ_FULL_LOAD
- **Owner:** Aggne
- **Recovery:** → `Failed Policy B&C Recovery` or `Failed Billing B&C Recovery`

---

### Entry 2.2 — ADF Pipeline Completion Required
- **Title:** `ADF Pipeline Completion Gate`
- **Type:** OperationalRule
- **Severity:** CRITICAL
- **Trigger:** Before Bronze population
- **Action:** All ADF pipelines must show SUCCESS status before Clarity Bronze is populated
- **Stop Condition:** Any pipeline FAILED → halt processing, alert Capricorn
- **Owner:** Capricorn/Informatica
- **Recovery:** → `ADF Pipeline Failure Recovery`

---

### Entry 2.3 — Canonical View Completeness Rule
- **Title:** `Canonical View Completeness Gate`
- **Type:** OperationalRule
- **Severity:** HIGH
- **Trigger:** Before GL SP execution
- **Action:** V_POLICY_CANON, V_BILLING_CANON, V_CLAIMS_CANON must all have non-zero row counts
- **Stop Condition:** Any canonical view is empty → stop GL, investigate Silver layer
- **Recovery:** → `ADF Pipeline Failure Recovery` or raise with Capricorn

---

### Entry 2.4 — Partial TRF Hold Decision Rule
- **Title:** `Partial TRF Hold Decision Rule`
- **Type:** OperationalRule
- **Severity:** HIGH
- **Decision Type:** STOP
- **Trigger:** TRF validation shows partial match
- **Action Steps:**
  1. Hold TRF submission
  2. Flag mismatched rows
  3. Notify DB Team lead + Aggne GL lead
  4. Escalate to leadership if unresolved in 2 hours
- **Recovery:** → `Partial TRF Recovery`

---

### Entry 2.5 — Full TRF Hold Decision Rule
- **Title:** `Full TRF Hold Decision Rule`
- **Type:** OperationalRule
- **Severity:** CRITICAL
- **Decision Type:** STOP
- **Trigger:** TRF validation shows full mismatch
- **Action Steps:**
  1. STOP all TRF submission immediately
  2. Alert leadership within 15 minutes
  3. Engage Aggne GL lead + DB Team + Capricorn
  4. Do not resubmit without DB Team sign-off
- **Recovery:** → `GL Reconciliation Failure Recovery`

---

## Category 3 — Validation Rules

> Type: `ValidationRule` | Checks that must pass at each processing gate

### Entry 3.1 — Policy B&C Validation Rule
- **Title:** `Policy B&C Validation Rule`
- **Type:** ValidationRule
- **Owner:** Aggne
- **Checks:**
  - Policy transaction count matches expected range
  - No null policy_ids
  - Effective dates within processing window
  - Premium amounts sum to expected total
- **SQL Template:**
  ```sql
  SELECT COUNT(*), SUM(premium_amount)
  FROM V_POLICY_CANON
  WHERE processing_date = {run_date}
    AND policy_id IS NOT NULL
  ```
- **Failure Action:** → `Failed Policy B&C Recovery`

---

### Entry 3.2 — Billing B&C Validation Rule
- **Title:** `Billing B&C Validation Rule`
- **Type:** ValidationRule
- **Owner:** Aggne
- **Checks:**
  - Billing transaction count within expected range
  - Debit/Credit balance = zero (net zero check)
  - No orphaned billing transactions (policy_id must exist)
- **SQL Template:**
  ```sql
  SELECT SUM(debit_amount) - SUM(credit_amount) AS net_balance,
         COUNT(*) AS row_count
  FROM V_BILLING_CANON
  WHERE processing_date = {run_date}
  ```
- **Failure Action:** → `Failed Billing B&C Recovery`

---

### Entry 3.3 — GL Balance Validation Rule
- **Title:** `GL Balance Validation Rule`
- **Type:** ValidationRule
- **Owner:** DB Team
- **Checks:**
  - Total GL AU debits = Total GL AU credits
  - Total GL NZ debits = Total GL NZ credits
  - GL totals match canonical view totals
- **SQL Template:**
  ```sql
  SELECT
    SUM(CASE WHEN entry_type = 'DR' THEN amount ELSE 0 END) AS total_dr,
    SUM(CASE WHEN entry_type = 'CR' THEN amount ELSE 0 END) AS total_cr,
    SUM(CASE WHEN entry_type = 'DR' THEN amount ELSE 0 END) -
    SUM(CASE WHEN entry_type = 'CR' THEN amount ELSE 0 END) AS balance
  FROM GL_DETAIL_AU
  WHERE run_date = {run_date}
  ```
- **Failure Action:** → `GL Reconciliation Failure Recovery`

---

### Entry 3.4 — Earned Premium Validation Rule
- **Title:** `Earned Premium Validation Rule`
- **Type:** ValidationRule
- **Owner:** DB Team
- **Checks:**
  - EM total matches sum from V_BILLING_CANON
  - No negative earned premium values
  - All policy periods accounted for
- **Failure Action:** → `EM Failure Recovery`

---

### Entry 3.5 — Reconciliation Tolerance Rule
- **Title:** `Reconciliation Tolerance Rule`
- **Type:** ValidationRule
- **Owner:** DB Team
- **Rule:** Variance must be ≤ 0.01% of total transaction value
- **Decision:** > tolerance → flag for investigation before close

---

## Category 4 — Recovery Rules

> Type: `RecoveryRule` | Step-by-step recovery for each failure mode

### Entry 4.1 — Failed Policy B&C Recovery
- **Title:** `Failed Policy B&C Recovery`
- **Type:** RecoveryRule
- **Owner:** Aggne
- **Trigger:** Policy B&C validation fails
- **Recovery Steps:**
  1. Identify failing records (run Policy B&C diagnostic query)
  2. Check ADF pipeline status for Policy source (Capricorn)
  3. Check V_POLICY_CANON row count vs previous run
  4. If data missing → request Capricorn rerun ADF Policy pipeline
  5. If data incorrect → Aggne investigates transformation logic
  6. Rerun B&C validation after fix
  7. Proceed only when PASS confirmed
- **Escalation:** If unresolved in 1 hour → notify DB Team lead

---

### Entry 4.2 — Failed Billing B&C Recovery
- **Title:** `Failed Billing B&C Recovery`
- **Type:** RecoveryRule
- **Owner:** Aggne
- **Trigger:** Billing B&C validation fails (net balance ≠ 0)
- **Recovery Steps:**
  1. Run missing billing transaction query
  2. Identify unmatched debit/credit pairs
  3. Check if source billing system completed export
  4. Request Capricorn rerun Billing ADF pipeline if source incomplete
  5. If data present but unbalanced → Aggne investigates billing logic
  6. Apply correction transactions if approved by DB Team
  7. Rerun B&C validation
- **Escalation:** If net imbalance > $10,000 → immediate leadership notification

---

### Entry 4.3 — Missing Billing Transaction Recovery
- **Title:** `Missing Billing Transaction Recovery`
- **Type:** RecoveryRule
- **Owner:** Aggne + Capricorn
- **Trigger:** Expected billing transactions not present in V_BILLING_CANON
- **Recovery Steps:**
  1. Identify missing transaction IDs
  2. Check source billing system export logs
  3. Capricorn reruns ADF Billing pipeline
  4. Validate V_BILLING_CANON row count post-rerun
  5. Re-execute B&C validation

---

### Entry 4.4 — Premium Mismatch Recovery
- **Title:** `Premium Mismatch Recovery`
- **Type:** RecoveryRule
- **Owner:** Aggne + DB Team
- **Trigger:** Premium amount in GL does not match V_POLICY_CANON
- **Recovery Steps:**
  1. Run premium mismatch detection query
  2. Compare GL_DETAIL_AU/NZ amounts vs canonical
  3. Identify mismatched policy IDs
  4. Aggne investigates GL processing logic for affected policies
  5. DB Team validates recalculation
  6. Rerun SP_GL_AU_FULL_LOAD or SP_GL_NZ_FULL_LOAD for affected policies
  7. Rerun reconciliation

---

### Entry 4.5 — EM Failure Recovery
- **Title:** `EM Failure Recovery`
- **Type:** RecoveryRule
- **Owner:** DB Team
- **Trigger:** Earned Premium validation fails
- **Recovery Steps:**
  1. Identify EM calculation errors using EM diagnostic query
  2. Check V_BILLING_CANON completeness for premium records
  3. Check V_POLICY_CANON for policy period coverage
  4. Recalculate EM for failing policies
  5. Repost corrected entries to GL_DETAIL_AU/NZ
  6. Rerun EM validation
  7. DB Team approves before month close proceeds

---

### Entry 4.6 — GL Reconciliation Failure Recovery
- **Title:** `GL Reconciliation Failure Recovery`
- **Type:** RecoveryRule
- **Severity:** CRITICAL
- **Owner:** DB Team + Aggne
- **Trigger:** GL reconciliation shows variance > tolerance
- **Recovery Steps:**
  1. Stop TRF generation immediately
  2. Run GL variance query to identify discrepancy
  3. Compare V_GL_AU_ALL + V_GL_NZ_ALL vs canonical views
  4. Identify root cause:
     - Missing transactions → Missing Billing Transaction Recovery
     - Balance error → GL Balance Validation investigation
     - Timing issue → request Capricorn recheck ADF timestamps
  5. Apply corrections
  6. Rerun SP_GL_AU_FULL_LOAD / SP_GL_NZ_FULL_LOAD
  7. Rerun reconciliation
  8. DB Team sign-off required before TRF generation resumes

---

### Entry 4.7 — ADF Pipeline Failure Recovery
- **Title:** `ADF Pipeline Failure Recovery`
- **Type:** RecoveryRule
- **Owner:** Capricorn/Informatica
- **Trigger:** ADF pipeline shows FAILED status
- **Recovery Steps:**
  1. Identify failing pipeline and error message
  2. Capricorn investigates ADF activity logs
  3. Resolve source connectivity/data issue
  4. Capricorn reruns ADF pipeline
  5. Validate Bronze population post-rerun
  6. Notify GL team when pipeline SUCCEEDED
- **Escalation:** If ADF cannot rerun within SLA → Snowflake Admin team engaged

---

### Entry 4.8 — Partial TRF Recovery
- **Title:** `Partial TRF Recovery`
- **Type:** RecoveryRule
- **Owner:** Aggne + DB Team
- **Trigger:** TRF partial match detected
- **Recovery Steps:**
  1. Identify mismatched TRF rows
  2. DB Team validates GL source data for mismatched rows
  3. Aggne regenerates TRF for affected subset
  4. Validate regenerated TRF
  5. Resubmit full corrected TRF to Informatica (Capricorn)
  6. Get Informatica confirmation receipt

---

## Category 5 — Ownership Rules

> Type: `OwnershipRule` | Who owns what — for routing and escalation

### Entry 5.1 — Operational Ownership Matrix
- **Title:** `GL Operational Ownership Matrix`
- **Type:** OwnershipRule
- **Content:**
  ```
  Component                    │ Primary Owner        │ Can Execute in Prod
  ─────────────────────────────┼──────────────────────┼────────────────────
  ADF Pipelines                │ Capricorn/Informatica │ Yes (rerun)
  Informatica Middleware       │ Capricorn/Informatica │ Yes (trigger)
  Policy B&C Validation        │ Aggne                 │ Yes (fix + rerun)
  Billing B&C Validation       │ Aggne                 │ Yes (fix + rerun)
  GL Processing (SPs)          │ Aggne                 │ Yes (rerun SPs)
  TRF Generation               │ Aggne                 │ Yes (regenerate)
  Reconciliation               │ DB Team               │ Yes (run queries)
  GL Balancing Validation      │ DB Team               │ Yes (validate)
  Earned Premium Validation    │ DB Team               │ Yes (validate)
  Monthly Processing Approval  │ DB Team               │ Yes (sign-off)
  Snowflake Execution Layer    │ Snowflake Admin        │ Yes (rerun procs)
  ```

---

### Entry 5.2 — Recovery Action Ownership
- **Title:** `Recovery Action Ownership Matrix`
- **Type:** OwnershipRule
- **Content:**
  ```
  Failure Scenario             │ First Responder       │ Escalation
  ─────────────────────────────┼───────────────────────┼───────────────────
  ADF Pipeline Failure         │ Capricorn             │ Snowflake Admin
  Policy B&C Failure           │ Aggne                 │ DB Team
  Billing B&C Failure          │ Aggne                 │ DB Team
  GL SP Failure                │ Aggne                 │ Snowflake Admin
  GL Reconciliation Failure    │ DB Team               │ Leadership
  TRF Generation Failure       │ Aggne                 │ DB Team + Leadership
  EM Validation Failure        │ DB Team               │ Leadership
  ```

---

## Category 6 — Notification Rules

> Type: `OperationalRule` | Who gets notified, when, and how

### Entry 6.1 — Leadership Notification Framework
- **Title:** `Leadership Notification Framework`
- **Type:** OperationalRule
- **Severity:** HIGH
- **Triggers for leadership notification:**
  - TRF full hold (full mismatch)
  - GL Reconciliation variance > tolerance
  - Monthly close at risk
  - Critical failure unresolved > 2 hours
- **Notification Steps:**
  1. Immediate: email + Slack to GL lead + Finance lead
  2. Include: issue description, impact assessment, ETA to resolution
  3. Update every 30 minutes until resolved
  4. Post-resolution: send summary + root cause + prevention plan

---

### Entry 6.2 — GL Processing Failure Alert
- **Title:** `GL Processing Failure Alert Protocol`
- **Type:** OperationalRule
- **Severity:** CRITICAL
- **Alert matrix:**
  ```
  Failure Type          │ Alert To                    │ Channel  │ SLA
  ──────────────────────┼─────────────────────────────┼──────────┼──────
  ADF Failure           │ Capricorn lead              │ Slack    │ 15min
  B&C Failure           │ Aggne GL lead               │ Slack    │ 15min
  GL SP Failure         │ Aggne + Snowflake Admin     │ Slack    │ 15min
  Recon Failure         │ DB Team lead + Aggne lead   │ Email    │ 30min
  TRF Hold              │ DB + Aggne + Leadership     │ Email    │ 15min
  Monthly close at risk │ Leadership                  │ Email    │ Immediate
  ```

---

## Category 7 — Escalation Rules

> Type: `OperationalRule` | Decision rules for escalation paths

### Entry 7.1 — GL Escalation Decision Tree
- **Title:** `GL Escalation Decision Tree`
- **Type:** OperationalRule
- **Decision Type:** ESCALATE
- **Escalation Logic:**
  ```
  Issue detected
    │
    ├─ Severity: LOW → team resolves internally (SLA: 4 hours)
    │
    ├─ Severity: MEDIUM → team lead notified (SLA: 2 hours)
    │
    ├─ Severity: HIGH → cross-team engagement (SLA: 1 hour)
    │                   → monthly close at risk alert
    │
    └─ Severity: CRITICAL → immediate leadership notification
                            → all hands: Aggne + DB + Capricorn + Snowflake Admin
                            → SLA: 30 minutes to status update
  ```

---

### Entry 7.2 — Cross-Team Escalation Rule
- **Title:** `Cross-Team Escalation Rule`
- **Type:** OperationalRule
- **Decision Type:** ESCALATE
- **Trigger:** Issue requires action from a team that does not own the failing component
- **Rule:**
  - Identify owning team (→ `GL Operational Ownership Matrix`)
  - Raise escalation via agreed channel (Slack #gl-production)
  - Include: issue, impact, action needed, SLA
  - Primary team stays engaged until resolved

---

## Category 8 — Reconciliation Rules

> Type: `ReconciliationRule` | Reconciliation logic and gates

### Entry 8.1 — GL Reconciliation Failure Handling
- **Title:** `GL Reconciliation Failure Handling`
- **Type:** ReconciliationRule
- **Owner:** DB Team
- **Trigger:** GL recon query shows variance > 0.01%
- **Action Steps:**
  1. Run GL variance query (→ `GL Reconciliation Variance Query`)
  2. Identify failing GL accounts
  3. Drill down: AU vs NZ, Premium vs non-premium
  4. Cross-reference with canonical views
  5. Invoke root cause: B&C failure, SP error, or timing gap
  6. Resolve using appropriate Recovery Rule
  7. Rerun reconciliation
  8. DB Team sign-off before month close
- **Recovery:** → `GL Reconciliation Failure Recovery`

---

### Entry 8.2 — AU/NZ Balance Reconciliation
- **Title:** `AU/NZ Balance Reconciliation Rule`
- **Type:** ReconciliationRule
- **Owner:** DB Team
- **Rule:** AU GL total and NZ GL total must each independently balance (DR = CR) before combined TRF can proceed

---

### Entry 8.3 — Monthly Close Reconciliation Gate
- **Title:** `Monthly Close Reconciliation Gate`
- **Type:** ReconciliationRule
- **Owner:** DB Team
- **Gate Criteria (ALL must be true to close):**
  - GL Balance Validation: PASS
  - Earned Premium Validation: PASS
  - AU/NZ Reconciliation: PASS
  - TRF submission confirmed by Informatica
  - DB Team lead sign-off obtained

---

## Category 9 — Dependency Rules

> Type: `OperationalRule` | What depends on what in the GL pipeline

### Entry 9.1 — GL Dependency Model
- **Title:** `GL Dependency Model`
- **Type:** Process
- **Content:**
  ```
  ADF Pipelines
    └─ depends on: Source systems (Policy, Billing, Claims) export completion
  Clarity Bronze
    └─ depends on: ADF Pipelines SUCCESS
  Clarity Silver
    └─ depends on: Clarity Bronze population
  V_POLICY_CANON, V_BILLING_CANON, V_CLAIMS_CANON
    └─ depends on: Clarity Silver
  Policy B&C + Billing B&C Validation
    └─ depends on: Canonical views non-empty
  SP_GL_AU_FULL_LOAD
    └─ depends on: V_POLICY_CANON, V_BILLING_CANON, V_CLAIMS_CANON
    └─ depends on: B&C validations PASS
  SP_GL_NZ_FULL_LOAD
    └─ depends on: (same as AU)
  GL_DETAIL_AU / GL_DETAIL_NZ
    └─ depends on: SP execution SUCCESS
  V_GL_DETAIL_AU, V_GL_AU_ALL, V_GL_DETAIL_NZ, V_GL_NZ_ALL
    └─ depends on: GL_DETAIL tables populated
  GL Reconciliation
    └─ depends on: GL views populated + GL Balance Validation PASS
  TRF Generation
    └─ depends on: GL Reconciliation PASS
  Informatica Submission
    └─ depends on: TRF validation PASS
  ```
- **Relationships:** feeds all other categories

---

### Entry 9.2 — SP_GL_AU_FULL_LOAD Dependencies
- **Title:** `SP_GL_AU_FULL_LOAD Dependencies`
- **Type:** OperationalRule
- **Depends On:**
  - V_POLICY_CANON row count > 0
  - V_BILLING_CANON row count > 0
  - V_CLAIMS_CANON row count > 0
  - Policy B&C = PASS
  - Billing B&C = PASS
- **Produces:** GL_DETAIL_AU (feeds V_GL_DETAIL_AU → V_GL_AU_ALL)

---

## Category 10 — View Definitions

> Type: `ViewDefinition` | Technical lineage for every GL view

### Entry 10.1 — V_POLICY_CANON
- **Title:** `V_POLICY_CANON Definition`
- **Type:** ViewDefinition
- **System:** Snowflake
- **Source:** Clarity Silver policy tables
- **Purpose:** Policy canonical view — single source of truth for policy data entering GL
- **Key Columns:** policy_id, effective_date, expiry_date, premium_amount, currency, source_system
- **Downstream:** SP_GL_AU_FULL_LOAD, SP_GL_NZ_FULL_LOAD, Policy B&C validation

---

### Entry 10.2 — V_BILLING_CANON
- **Title:** `V_BILLING_CANON Definition`
- **Type:** ViewDefinition
- **Source:** Clarity Silver billing tables
- **Purpose:** Billing canonical view — all billing transactions normalised
- **Key Columns:** transaction_id, policy_id, billing_date, debit_amount, credit_amount, transaction_type
- **Downstream:** SP_GL_AU_FULL_LOAD, SP_GL_NZ_FULL_LOAD, Billing B&C, EM calculation

---

### Entry 10.3 — V_CLAIMS_CANON
- **Title:** `V_CLAIMS_CANON Definition`
- **Type:** ViewDefinition
- **Source:** Clarity Silver claims tables
- **Purpose:** Claims canonical view — normalised claims feeding GL
- **Key Columns:** claim_id, policy_id, claim_date, claim_amount, claim_type, currency
- **Downstream:** SP_GL_AU_FULL_LOAD, SP_GL_NZ_FULL_LOAD

---

### Entry 10.4 — V_GL_AU_ALL
- **Title:** `V_GL_AU_ALL Definition`
- **Type:** ViewDefinition
- **Source:** GL_DETAIL_AU
- **Purpose:** Consolidated AU GL view — all GL entries for Australia
- **Downstream:** Reconciliation, TRF Generation, GL Balance Validation

---

### Entry 10.5 — V_GL_NZ_ALL
- **Title:** `V_GL_NZ_ALL Definition`
- **Type:** ViewDefinition
- **Source:** GL_DETAIL_NZ
- **Purpose:** Consolidated NZ GL view — all GL entries for New Zealand
- **Downstream:** Reconciliation, TRF Generation, GL Balance Validation

---

### Entry 10.6 — V_GL_DETAIL_AU
- **Title:** `V_GL_DETAIL_AU Definition`
- **Type:** ViewDefinition
- **Source:** GL_DETAIL_AU
- **Purpose:** Detailed AU GL entries with full transaction breakdown
- **Downstream:** V_GL_AU_ALL, reconciliation drill-down queries

---

### Entry 10.7 — V_GL_DETAIL_NZ
- **Title:** `V_GL_DETAIL_NZ Definition`
- **Type:** ViewDefinition
- **Source:** GL_DETAIL_NZ
- **Purpose:** Detailed NZ GL entries with full transaction breakdown
- **Downstream:** V_GL_NZ_ALL, reconciliation drill-down queries

---

## Category 11 — Stored Procedures

> Type: `QueryExample` | SP definitions with parameters and logic

### Entry 11.1 — SP_GL_AU_FULL_LOAD
- **Title:** `SP_GL_AU_FULL_LOAD Definition`
- **Type:** QueryExample
- **System:** Snowflake
- **Owner:** Aggne (run by Snowflake Admin in prod)
- **Parameters:** run_date DATE, mode VARCHAR (FULL/DELTA)
- **Logic:**
  ```
  1. TRUNCATE GL_DETAIL_AU (for FULL mode)
  2. INSERT INTO GL_DETAIL_AU
     SELECT from V_POLICY_CANON + V_BILLING_CANON + V_CLAIMS_CANON
     WHERE processing_region = 'AU'
       AND processing_date = {run_date}
  3. Apply GL mapping rules
  4. Post debit/credit entries
  5. Return row count and total amounts
  ```
- **Upstream:** V_POLICY_CANON, V_BILLING_CANON, V_CLAIMS_CANON
- **Downstream:** GL_DETAIL_AU → V_GL_DETAIL_AU → V_GL_AU_ALL

---

### Entry 11.2 — SP_GL_NZ_FULL_LOAD
- **Title:** `SP_GL_NZ_FULL_LOAD Definition`
- **Type:** QueryExample
- **System:** Snowflake
- **Owner:** Aggne (run by Snowflake Admin in prod)
- **Logic:** Same as SP_GL_AU_FULL_LOAD with region = 'NZ'
- **Downstream:** GL_DETAIL_NZ → V_GL_DETAIL_NZ → V_GL_NZ_ALL

---

## Category 12 — Query Library

> Type: `QueryExample` | Reusable diagnostic and operational queries

### Entry 12.1 — GL Balance Check Query
- **Title:** `GL Balance Check Query`
- **Type:** QueryExample
- **Tags:** GL, balance, validation, diagnostic
- **SQL:**
  ```sql
  -- GL AU Balance Check
  SELECT
    run_date,
    SUM(CASE WHEN entry_type='DR' THEN amount ELSE 0 END) AS total_debit,
    SUM(CASE WHEN entry_type='CR' THEN amount ELSE 0 END) AS total_credit,
    SUM(CASE WHEN entry_type='DR' THEN amount ELSE 0 END) -
    SUM(CASE WHEN entry_type='CR' THEN amount ELSE 0 END) AS net_balance
  FROM GL_DETAIL_AU
  WHERE run_date = {run_date}
  GROUP BY run_date
  -- Expected: net_balance = 0
  ```

---

### Entry 12.2 — Canonical View Row Count Check
- **Title:** `Canonical View Row Count Check`
- **Type:** QueryExample
- **Tags:** canonical, validation, row-count
- **SQL:**
  ```sql
  SELECT
    'V_POLICY_CANON' AS view_name, COUNT(*) AS row_count FROM V_POLICY_CANON WHERE processing_date = {run_date}
  UNION ALL
  SELECT 'V_BILLING_CANON', COUNT(*) FROM V_BILLING_CANON WHERE processing_date = {run_date}
  UNION ALL
  SELECT 'V_CLAIMS_CANON', COUNT(*) FROM V_CLAIMS_CANON WHERE processing_date = {run_date}
  -- All rows must be > 0 before GL SPs can run
  ```

---

### Entry 12.3 — Missing Billing Transaction Query
- **Title:** `Missing Billing Transaction Query`
- **Type:** QueryExample
- **SQL:**
  ```sql
  SELECT b.transaction_id, b.policy_id, b.billing_date, b.debit_amount, b.credit_amount
  FROM V_BILLING_CANON b
  LEFT JOIN GL_DETAIL_AU g ON g.source_transaction_id = b.transaction_id
  WHERE b.processing_date = {run_date}
    AND g.source_transaction_id IS NULL
  ORDER BY b.billing_date
  ```

---

### Entry 12.4 — GL Reconciliation Variance Query
- **Title:** `GL Reconciliation Variance Query`
- **Type:** QueryExample
- **SQL:**
  ```sql
  SELECT
    c.total_canon_amount,
    g.total_gl_amount,
    c.total_canon_amount - g.total_gl_amount AS variance,
    ROUND(ABS(c.total_canon_amount - g.total_gl_amount) / c.total_canon_amount * 100, 4) AS variance_pct
  FROM (
    SELECT SUM(premium_amount) AS total_canon_amount
    FROM V_POLICY_CANON WHERE processing_date = {run_date}
  ) c,
  (
    SELECT SUM(amount) AS total_gl_amount
    FROM GL_DETAIL_AU WHERE run_date = {run_date}
  ) g
  -- variance_pct must be <= 0.01% to pass
  ```

---

### Entry 12.5 — Premium Mismatch Detection Query
- **Title:** `Premium Mismatch Detection Query`
- **Type:** QueryExample
- **SQL:**
  ```sql
  SELECT
    p.policy_id,
    p.premium_amount AS canon_premium,
    g.amount AS gl_amount,
    p.premium_amount - g.amount AS mismatch_amount
  FROM V_POLICY_CANON p
  JOIN GL_DETAIL_AU g ON g.policy_id = p.policy_id AND g.run_date = {run_date}
  WHERE p.processing_date = {run_date}
    AND ABS(p.premium_amount - g.amount) > 0.01
  ORDER BY ABS(p.premium_amount - g.amount) DESC
  ```

---

### Entry 12.6 — Monthly Processing Status Query
- **Title:** `Monthly Processing Status Query`
- **Type:** QueryExample
- **SQL:**
  ```sql
  SELECT
    'ADF Pipelines'        AS step, pipeline_status AS status, run_date FROM adf_run_log WHERE run_date = {run_date}
  UNION ALL
  SELECT 'V_POLICY_CANON', CASE WHEN COUNT(*)>0 THEN 'OK' ELSE 'EMPTY' END, {run_date} FROM V_POLICY_CANON WHERE processing_date={run_date}
  UNION ALL
  SELECT 'V_BILLING_CANON', CASE WHEN COUNT(*)>0 THEN 'OK' ELSE 'EMPTY' END, {run_date} FROM V_BILLING_CANON WHERE processing_date={run_date}
  UNION ALL
  SELECT 'GL_DETAIL_AU', CASE WHEN COUNT(*)>0 THEN 'LOADED' ELSE 'EMPTY' END, {run_date} FROM GL_DETAIL_AU WHERE run_date={run_date}
  UNION ALL
  SELECT 'GL_DETAIL_NZ', CASE WHEN COUNT(*)>0 THEN 'LOADED' ELSE 'EMPTY' END, {run_date} FROM GL_DETAIL_NZ WHERE run_date={run_date}
  ```

---

## Category 13 — Runbooks

> Type: `Process` | Operational runbooks for known scenarios

### Entry 13.1 — GL Daily Processing Runbook
- **Title:** `GL Daily Processing Runbook`
- **Type:** Process
- **Owner:** All teams (coordinated)
- **Steps:**
  ```
  PRE-CHECK (Capricorn):
  □ All ADF pipelines show SUCCESS in ADF Monitor
  □ Bronze tables populated for today's run_date
  □ Silver tables populated

  VALIDATION (Aggne):
  □ Run Canonical View Row Count Check
  □ All 3 canonical views > 0 rows
  □ Run Policy B&C Validation → PASS
  □ Run Billing B&C Validation → PASS

  GL EXECUTION (Aggne + Snowflake Admin):
  □ Execute SP_GL_AU_FULL_LOAD(run_date := today, mode := 'FULL')
  □ Confirm GL_DETAIL_AU row count
  □ Execute SP_GL_NZ_FULL_LOAD(run_date := today, mode := 'FULL')
  □ Confirm GL_DETAIL_NZ row count

  VALIDATION (DB Team):
  □ Run GL Balance Check Query → net_balance = 0 for AU
  □ Run GL Balance Check Query → net_balance = 0 for NZ
  □ Run GL Reconciliation Variance Query → variance_pct ≤ 0.01%

  TRF (Aggne):
  □ Generate TRF from V_GL_AU_ALL + V_GL_NZ_ALL
  □ Validate TRF row count and amounts
  □ Decision gate: Full match / Partial / Full hold

  SUBMISSION (Capricorn):
  □ Submit TRF to Informatica API
  □ Confirm Informatica receipt

  SIGN-OFF (DB Team):
  □ Monthly processing status confirmed
  □ All validations PASS
  □ Close daily run
  ```

---

### Entry 13.2 — GL Reconciliation Failure Runbook
- **Title:** `GL Reconciliation Failure Runbook`
- **Type:** Process
- **Owner:** DB Team (lead) + Aggne + Capricorn
- **Steps:**
  ```
  IMMEDIATE:
  1. Stop TRF generation
  2. Alert: DB lead + Aggne GL lead + Capricorn lead
  3. Run GL Reconciliation Variance Query → identify variance amount

  DIAGNOSIS:
  4. Check canonical view counts → any empty?
  5. Check B&C validation results → any failures?
  6. Run Missing Billing Transaction Query
  7. Run Premium Mismatch Detection Query
  8. Identify root cause

  RESOLUTION (based on root cause):
  → ADF issue: Capricorn reruns pipeline
  → B&C issue: Aggne fixes + reruns
  → GL SP issue: Snowflake Admin reruns SP
  → Data issue: DB Team + Aggne correct and repost

  VALIDATION:
  9. Rerun GL Balance Check
  10. Rerun Reconciliation Variance Query → must be ≤ 0.01%
  11. DB Team sign-off

  RESUME:
  12. Generate TRF
  13. Submit to Informatica
  14. Send resolution notification to leadership
  ```

---

## Steps to Add This into SAI KB

### Step 1 — Create KB Schema
> SAI Knowledge → Schemas tab → New KB Schema
- Name: `General Ledger`
- Color: Green (#059669)

### Step 2 — Use Guided KT Wizard for SQL Objects
> Knowledge Base tab → 🎓 Guided KT
- Schema: General Ledger
- Add each stored procedure and canonical view as SQL objects
- Link: V_POLICY_CANON → SP_GL_AU_FULL_LOAD → GL_DETAIL_AU

### Step 3 — Add Knowledge Entries by Category
> For each entry in this blueprint:
> Knowledge Base tab → + Add Entry

| Category | SAI Entry Type | Count |
|---|---|---|
| Process Knowledge | Process | 4 |
| Operational Rules | OperationalRule | 5 |
| Validation Rules | ValidationRule | 5 |
| Recovery Rules | RecoveryRule | 8 |
| Ownership Rules | OwnershipRule | 2 |
| Notification Rules | OperationalRule | 2 |
| Escalation Rules | OperationalRule | 2 |
| Reconciliation Rules | ReconciliationRule | 3 |
| Dependency Rules | OperationalRule | 2 |
| View Definitions | ViewDefinition | 7 |
| Stored Procedures | QueryExample | 2 |
| Query Library | QueryExample | 6 |
| Runbooks | Process | 2 |
| **TOTAL** | | **~50 atomic entries** |

### Step 4 — Ask SAI Examples After Loading

| Question | Format | Expected Response |
|---|---|---|
| "GL reconciliation failed — what do I do?" | Answer | GL Reconciliation Failure Recovery steps |
| "Who owns TRF generation?" | Answer | Aggne owns, Capricorn submits |
| "Show the full GL pipeline" | Flow Diagram | Mermaid diagram from ADF to Informatica |
| "Write the GL balance check SQL" | Generate | GL Balance Check Query with {run_date} |
| "What must complete before SP_GL_AU_FULL_LOAD runs?" | Answer | Dependency model — 5 prerequisites |
| "EM validation failed — recovery steps?" | Steps | EM Failure Recovery runbook |
| "Plan for adding a new canonical view" | Implementation Plan | Step-by-step integration plan |

---

*GL SAI KB Blueprint v1.0 — docs/GL_SAI_KB_Blueprint.md*
