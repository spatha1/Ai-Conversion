# Query Generation Skill

This file is the shared knowledge base for all SQL generation in the platform.
It is loaded at runtime and enriched with live schema data (tables, FK relationships,
sample values) discovered from the connected legacy database.

Edit this file to add domain knowledge, business rules, and SQL style preferences.
The runtime engine will append the discovered schema automatically — do not add
schema details here manually (they will be overwritten each run).

---

## Domain Context

<!-- Describe the purpose of the data and the conversion project. -->
<!-- Example:
This is a legacy insurance policy system. The core entity is a Policy (policy_tbl).
Each Policy has one Insured party, one or more Vehicles, and each Vehicle has one or
more Coverage lines. The conversion produces DCT-compliant XML payloads per Policy.
-->



---

## SQL Style Rules

<!-- Specify SQL formatting and behaviour preferences for generated queries. -->
<!-- These apply to both Mapping queries and Report queries. -->
<!-- Example:
- Use WITH (NOLOCK) on all tables for read-only conversion queries
- Always alias tables: p = policy_tbl, i = insured_tbl, v = vehicle_tbl
- Prefer ISNULL(col, '') over COALESCE for SQL Server
- Format dates using CONVERT(VARCHAR(10), col, 23) → YYYY-MM-DD
- Use UPPER(LTRIM(RTRIM(col))) for any string key/code columns
-->



---

## Business Rules

<!-- Document field-level rules, code table meanings, and validation logic. -->
<!-- Example:
- Status codes: 'A' = Active, 'C' = Cancelled, 'X' = Expired — always filter Status = 'A'
- policy_tbl.record_type = 'POL' identifies master policy rows (exclude endorsements)
- Coverage amounts are stored in cents — divide by 100 for XML output
- Insured DOB is stored as VARCHAR in YYYYMMDD format — convert to YYYY-MM-DD
- VehicleYear must be > 1900 to be valid; exclude records where VehicleYear IS NULL
-->



---

## Known Table Relationships

<!-- Supplement auto-discovered FK relationships with any missing or implied JOINs. -->
<!-- The runtime engine loads FK relationships from the schema catalog automatically. -->
<!-- Use this section only for relationships not captured by foreign keys in the DB. -->
<!-- Format: child_table.child_col → parent_table.parent_col [JOIN type] [notes] -->
<!-- Example:
- address_tbl.entity_id → policy_tbl.policy_id  (LEFT JOIN, nullable — not a FK in DB)
- agent_tbl.agent_code  → policy_tbl.agent_code (LEFT JOIN, code-based join, no FK)
-->



---

## Mapping Query Rules

<!-- Rules specific to the Mapping tab query generator (XML payload extraction). -->
<!-- Example:
- The root entity is policy_tbl — always start the FROM clause from policy_tbl
- Always include policy_tbl.policy_id as the __identifier__ column
- Exclude test/dummy policies where policy_tbl.test_flag = 1
- For vehicle iteration: use vehicle_tbl as the each= scope table
-->



---

## Report Query Rules

<!-- Rules specific to the Report tab natural language → SQL generator. -->
<!-- Example:
- When asked about "active" records, always filter Status = 'A' unless told otherwise
- When asked for counts, include a breakdown by status
- Limit all report queries to a maximum of 10,000 rows
- When asked about dollar amounts, display as formatted currency (e.g. $1,234.56)
-->


