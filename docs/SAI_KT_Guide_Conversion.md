# SAI Knowledge Hub — KT Guide for Conversion Project

**URL:** http://104.211.112.63  
**Login:** Use your assigned credentials  
**Purpose:** Capture the full conversion architecture so SAI can answer questions, generate SQL, and guide new team members — no DB access required.

---

## What We're Capturing

```
Legacy DB
  └─► Staging Tables (Policyattach_1, T_Policyattach_000, etc.)
        └─► Views (one per XML group)
              └─► Small XML SP (dynamic, takes source view + formula + target table)
                    └─► Big XML Assembly SP
                          └─► Final XML Output
```

---

## Step 1 — Create the KB Schema (one-time)

1. Go to **SAI Knowledge → Schemas tab**
2. Click **"New KB Schema"**
3. Name: `Policy Conversion` (or your project name)
4. Pick a color → **Create**

> This groups all knowledge under one searchable scope.

---

## Step 2 — Import the DB Schema

1. **Schemas tab → "Import DB Schema"**
2. Name: `Policy Conversion` (same as above)
3. Paste your full DDL scripts (all CREATE TABLE / CREATE VIEW statements)  
   — **No character limit** — paste the entire 8000+ line script
4. Click **"Import & Embed"**
5. Watch the live progress log:
   ```
   [1/7] Embedding Policyattach_1 (63 cols)…
   [2/7] Embedding T_Policyattach_000 (18 cols)…
   Done! 7 tables, 139 columns, 139 embeddings.
   ```

**Ask for from the developer:**
- All `CREATE TABLE` scripts for staging tables
- All `CREATE VIEW` scripts for XML group views
- The SP definition for the Small XML generator
- The SP definition for the Big XML assembler

---

## Step 3 — Use the Guided KT Wizard

1. **SAI Knowledge → Knowledge Base tab → "🎓 Guided KT"**

### Step 3.1 — Project Setup
- Schema: select `Policy Conversion`
- KT Title: `Policy Attach Conversion — XML Architecture`
- System: `Snowflake`
- Description: `Legacy policy data extracted to staging, transformed through views, converted to XML groups via dynamic SPs, assembled into final big XML`

### Step 3.2 — Upload Schema (skip if done in Step 2)

### Step 3.3 — Add SQL Objects

Add each item in order:

| Name | Type | Purpose | XML Group | Feeds Into |
|------|------|---------|-----------|------------|
| `Policyattach_1` | Table | Main staging table with all 63 policy fields | — | — |
| `T_Policyattach_000` | Table | Staging sub-table for group 000 | — | — |
| `PolicyHeader_VW` (example) | View | Extracts PolicyHeader fields for XML | PolicyHeader | GenerateSmallXML_SP |
| `ClaimsGroup_VW` (example) | View | Extracts Claims fields | Claims | GenerateSmallXML_SP |
| `GenerateSmallXML_SP` | Stored Procedure | Generates small XML per group | — | AssembleBigXML_SP |
| `AssembleBigXML_SP` | Stored Procedure | Assembles all small XMLs into big XML | BIG_XML | — |

**For each Stored Procedure, fill in:**
- **Source View:** e.g. `PolicyHeader_VW`
- **Target Table:** e.g. `xml_output_policy`
- **Formula / {} Template:** e.g. `SELECT {policy_id}, {policy_number} FROM {source_view}`

### Step 3.4 — KT Session

Paste the developer's explanation:
```
Example of what to paste:
"The conversion works as follows: Legacy data is first loaded into the 
staging table Policyattach_1. We have one view per XML group — PolicyHeader_VW 
selects policy_id, policy_number, effective_date from staging. The 
GenerateSmallXML_SP is dynamic — it takes the source view name and a formula 
with {} placeholders and generates XML. Finally AssembleBigXML_SP collects 
all small XMLs and creates the final output."
```

Click **"Create Session & Analyse"** — SAI will suggest 3-7 KB entries from the explanation.

### Step 3.5 — Review & Save

- Check the pipeline flow preview
- Click **"✅ Save All to KB"**

---

## Step 4 — Add Individual KB Entries (for detail)

For each view and SP that needs more explanation:

1. **Knowledge Base tab → "+ Add Entry"**
2. Schema: `Policy Conversion`
3. Type: `QueryExample` (for views/SPs) or `Process` (for SPs)
4. **Add Block → SQL Query**
   - Name the block: e.g. `PolicyHeader_VW`
   - Paste the full SQL
   - Explain: *"This view extracts PolicyHeader fields from Policyattach_1 staging table for XML group generation"*
5. **Add Block → Text** (optional)
   - Name: `XML Mapping`
   - Content: which `{}` placeholders map to which columns
6. Click **"🔍 Preview AI Understanding"** to verify SAI understood correctly
7. Click **"Process & Save"**

---

## Step 5 — Verify SAI Can Answer

Go to **Ask SAI tab**:

| Select format | Ask | Expected response |
|---|---|---|
| **Flow Diagram** | "Show the full pipeline from staging to big XML" | Mermaid diagram of the architecture |
| **Answer** | "What columns are in Policyattach_1?" | Lists all 63 columns |
| **Generate** | "Write the Snowflake SQL to extract PolicyHeader from staging" | SQL query with {} placeholders |
| **Explain** | "What does GenerateSmallXML_SP do?" | Plain English explanation |
| **Implementation Plan** | "How do I add a new XML group?" | Step-by-step plan |

**Before asking:** Select **"DB Schema: Policy Conversion"** in the Schema chip row to use the embedded column knowledge.

---

## What to Collect from the Developer (Checklist)

```
□ CREATE TABLE scripts for all staging tables
  (Policyattach_1, T_Policyattach_000, T_Policyattach_002, 
   T_Policyattach_003, T_Policyattach_006, POLICYATTACH_TEMP, 
   TA_ADJUST_PolicyAttach)

□ CREATE VIEW scripts for each XML group view
  (one view per group — PolicyHeader_VW, ClaimsGroup_VW, etc.)

□ GenerateSmallXML_SP full script
  - What parameters it takes (source_view, formula, target_table)
  - The {} placeholder convention
  - Example call with sample values

□ AssembleBigXML_SP full script
  - How it collects small XMLs
  - Output format / destination

□ Sample XML output (one small XML + one big XML)
  - Shows the {} fields and what they map to

□ Plain-language explanation (paste into KT Session):
  - "The process works as follows: [developer explains in their own words]"
  - Any edge cases, known issues, or special rules
  - Which views feed which SP
  - How to add a new XML group
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| SAI says "I don't know" | Select the DB Schema chip in Ask SAI toolbar first |
| Import gets cut off | The full DDL is supported — no character limit. Check for syntax errors in the script |
| Schema not showing in Ask SAI | Refresh the page (Ctrl+Shift+R) |
| Entries have no embeddings | Go to Knowledge Base → click "Rebuild Embeddings" |
| Preview shows wrong understanding | Edit the block explanation to be more specific, re-preview |

---

*Last updated: May 2026 | SAI Knowledge Hub v2*
