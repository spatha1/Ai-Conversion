# SAI — Simple Guide for XML Conversion Project

**URL:** http://104.211.112.63  
**Project:** Policy Attach / XML Generation Pipeline

---

## The Conversion Pipeline (What We're Documenting)

```
Legacy Source Tables
    ↓
Staging / Temp Tables
    ↓
Source Views  (V_{GroupName}_SRC)  ← business rules live here
    ↓
Config Records                      ← mapping: view → template → target
    ↓
Target Tables                       ← one per XML Group
    ↓
XML Generation Views
    ↓
Small XMLs (one per Group)
    ↓
Big XML Assembly SP
    ↓
Final XML Output
```

---

## One-Time Setup (Do This First)

### 1. Create the Schema
> SAI Knowledge → Schemas tab → **New KB Schema**

- Name: `Policy Conversion`
- Color: any
- Click **Create**

This is your workspace — all knowledge goes here.

---

## How to Add Knowledge for Each Step

### For Each Processing Step — Create a Session + Entries

> Sessions tab → **New** → Type: `KnowledgeUpload` → Schema: `Policy Conversion`

**One session per step:**

| Session Title | What to paste |
|---|---|
| `Step 1: Collect Legacy Data` | Description of which legacy tables, what data, any transformations |
| `Step 2: Prepare Source Views` | Which views created, what business rules, which group they serve |
| `Step 3: Configure XML Mapping` | Config record structure, template placeholders `{}` |
| `Step 4: Load Target Tables` | How the dynamic SP reads config and loads target tables |
| `Step 5: Generate XML` | How the XML views assemble the output |
| `Step 6: Validate & Troubleshoot` | Traceability path, known issues |

After creating each session → click **"Ask SAI What to Feed"** → SAI suggests KB entries → click "Add to KB".

---

## For Each XML Group — One Entry with All Details

> Knowledge Base tab → **+ Add Entry**

- Schema: `Policy Conversion`
- Type: `UseCase`
- Title: `[GroupName] XML Group KT`

**Add these Content Blocks:**

| Block | Name | Content |
|---|---|---|
| 📝 Text | "Group Overview" | What this group produces, which part of XML, business purpose |
| 🗄️ SQL | "Source View SQL" | Full `CREATE VIEW V_{Group}_SRC AS ...` |
| 📝 Text | "Source Tables" | List of staging tables + legacy source tables used |
| 📝 Text | "Join Conditions" | How legacy tables are joined, key columns |
| 📝 Text | "Business Rules" | Rules applied in the view (filters, transformations) |
| 📝 Text | "XML Formula" | The `{placeholder}` template / config record fields |
| 🗄️ SQL | "Target Table" | `SELECT * FROM TargetTable_{Group}` or `INSERT INTO` pattern |

Click **"🔍 Preview AI Understanding"** → verify SAI understood all blocks → **Process & Save**

---

## For the Final XML Assembly — One Process Entry

> Knowledge Base → + Add Entry → Type: `Process`

- Title: `Final XML Assembly Process`
- Schema: `Policy Conversion`

**Content Blocks:**
- 📝 Text: "Overview" — List all XML groups and the order they run
- 🗄️ SQL: "Small XML SP" — `GenerateSmallXML_SP` code + what parameters it takes
- 🗄️ SQL: "Big XML SP" — `AssembleBigXML_SP` code + how it collects small XMLs
- 📝 Text: "Sequence" — Which group runs first, dependencies between groups
- 📝 Text: "Error Handling" — What to do if a group fails

---

## Bulk Import Option (Faster for Many Groups)

If you have many XML groups, create a CSV file:

```csv
title,raw_content,type,system,tags,op_category,severity,owner_team
"PolicyHeader XML Group KT","Group: PolicyHeader. Purpose: ... Source View: V_PolicyHeader_SRC. Staging Tables: STG_Policy. Legacy Tables: LEGACY_POLICY. Join: policy_id. Business Rules: active policies only. XML Formula: {policy_id}{policy_number}...",UseCase,Snowflake,"PolicyHeader,xml-group,kt",BusinessProcess,,
"ClaimsGroup XML Group KT","Group: Claims. Purpose: ...",UseCase,Snowflake,"Claims,xml-group,kt",BusinessProcess,,
```

Then: **Knowledge Base → Bulk Import → Schema: Policy Conversion → upload CSV**

All entries get tagged to your schema automatically.

---

## Adding Rules and Process Guidelines

For **validation rules** (things that must be true):

> Add Entry → Type: `ValidationRule`
- Title: `B&C Must Pass Before XML Generation`
- Content: "Trigger: XML generation requested. Check: Policy B&C and Billing B&C must both be PASS. Stop if either fails."

For **recovery rules** (what to do when it breaks):

> Add Entry → Type: `RecoveryRule`
- Title: `Missing Data in [GroupName] XML`
- Content: "Step 1: Check V_{Group}_SRC row count. Step 2: Check staging table. Step 3: ..."

---

## After Loading — Test with Ask SAI

> Ask SAI tab → Schema chip: `Policy Conversion` → ask:

| Question | Format | What you get |
|---|---|---|
| "What are the steps to generate XML?" | **Flow Diagram** | Visual pipeline from legacy → XML |
| "How is PolicyHeader XML generated?" | **Answer** | Source view, staging tables, formula |
| "Claims XML data is missing — how to trace?" | **Troubleshoot** | Step-by-step trace path |
| "Write a query to validate PolicyHeader source view" | **Generate** | SQL with row count check |
| "Explain the XML config record structure to a new team member" | **Teach Me** | Clear explanation with examples |
| "What business rules apply in Step 2?" | **Answer** | All ValidationRule entries for Step 2 |

---

## What to Collect from the Team (Checklist)

```
For each XML Group:
□ Group name and business purpose
□ Full source view SQL (V_{Group}_SRC)
□ Staging table names (STG_xxx)
□ Legacy source table names
□ Join conditions between staging and legacy
□ Business rules applied in the view
□ XML template / {} formula
□ Target table name
□ Known issues or edge cases

For the overall process:
□ GenerateSmallXML_SP full code
□ AssembleBigXML_SP full code
□ Config record table structure
□ Processing sequence (which group runs first)
□ Any B&C or validation checks before running
```

---

## Quick Troubleshooting

| Problem | Solution |
|---|---|
| Ask SAI says "I don't know" | Make sure you selected `Policy Conversion` schema chip in Ask SAI |
| Entries not visible in KB | Hard refresh (Ctrl+Shift+R) |
| Bulk import failed rows | Check the raw_content column — must be at least 10 chars |
| Schema import only got some tables | Split DDL: CREATE TABLE statements only in one file |
| Session not showing in session dropdown | Refresh — sessions filter by schema when schema is selected |

---

*SAI Simple Guide — Conversion Project | docs/SAI_Conversion_Simple_Guide.md*
