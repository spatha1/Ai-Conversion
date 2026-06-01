# Guided KT Wizard — How It Works

**Where:** SAI Knowledge → Knowledge Base tab → **🎓 Guided KT** button

---

## What Is It?

The Guided KT Wizard is a 5-step form that captures a full project knowledge transfer in one flow.  
Instead of adding entries one by one, you go through steps — and at the end everything is saved together.

---

## The 5 Steps

### Step 1 — Project Setup
Tell SAI what project this KT is for.

| Field | What to enter |
|---|---|
| Schema | Pick an existing schema (e.g. `Policy Conversion`) OR type a new name and click **Create** |
| KT Title | A name for this KT session (e.g. `GL Group XML Architecture`) |
| System | Snowflake / DCT / General |
| Description | One sentence — what does this system do? |

> The schema groups all the knowledge together so Ask SAI can scope answers to this project only.

---

### Step 2 — Upload DB Schema *(optional but recommended)*
Share the database schema without giving DB access.

**What to provide:**
- Paste `CREATE TABLE` / `CREATE VIEW` SQL scripts, OR
- Upload an Excel data dictionary (Table / Column / Type), OR
- Upload an ER diagram image (vision AI extracts the schema)

**What happens:**
SAI parses every table and column, generates embeddings, and makes them available in Ask SAI's **DB Schema** selector.

> Skip this step if you don't have DDL yet — you can always import later from Schemas tab.

---

### Step 3 — SQL Objects
Add each SQL object the team built: views, stored procedures, functions.

**Click "+ Add Object" for each one:**

| Field | Example |
|---|---|
| Name | `PolicyHeader_VW` or `GenerateSmallXML_SP` |
| Type | View / Stored Procedure / Function |
| SQL Code | Paste the full SQL |
| Purpose | One sentence — what does it do? |
| XML Group | Which output group it feeds (e.g. `PolicyHeader`) |
| Feeds Into | Which other object it connects to (builds the pipeline graph) |

**For Stored Procedures, also fill in:**
- **Source View** — which view it reads from
- **Target Table** — where it writes output
- **Formula / Template** — the `{placeholder}` pattern it uses

> "Feeds Into" creates a dependency link: View → SP → XML Group. Ask SAI uses this to explain the full pipeline.

---

### Step 4 — KT Session
Capture the knowledge in the employee's own words.

**Left panel — paste notes:**
- Type or paste the meeting transcript / explanation
- Or upload a `.txt` / `.pdf` / `.docx` file

**Click "Create Session & Analyse":**
SAI reads the transcript, checks what's already in the KB, and suggests 3–7 knowledge entries.

**Right panel — review suggestions:**
Each suggestion shows: title, entry type, and why SAI thinks it's worth capturing.
- ✅ Check the ones you want to keep
- Uncheck any that are already covered

---

### Step 5 — Review & Save
See everything that will be saved before committing.

| Section | What it shows |
|---|---|
| Schema | Name + tables/columns embedded count |
| SQL Objects | Count of views and SPs |
| Session | Session name created |
| KB Entries | How many suggestions selected |
| Pipeline Flow | Text preview of the dependency chain |

**"Generate Flow Diagram" button** — opens Ask SAI pre-filled to draw the full pipeline as a Mermaid diagram.

**"✅ Save All" button** — saves everything at once:
1. Each SQL object → KB entry (type `QueryExample` or `Process`)
2. Each selected suggestion → KB entry
3. Dependency links between objects (`feeds` relationships)

---

## After the Wizard

Once saved, go to **Ask SAI tab** and:

1. Select your schema chip (e.g. `Policy Conversion`)
2. If you imported a DB schema, also select it under **DB Schema:**
3. Ask anything:

| Question | Format chip | What you get |
|---|---|---|
| "Show the full pipeline" | Flow Diagram | Mermaid diagram of all steps |
| "What does PolicyHeader_VW do?" | Answer | SQL summary + purpose |
| "Claims XML data is missing — how to trace?" | Troubleshoot | Step-by-step trace path |
| "Write a query to validate the source view" | Generate | SQL with parameters |
| "Explain the {} SP to a new team member" | Teach Me | Plain English explanation |

---

## Quick Summary

```
Step 1: Pick/create schema + give the KT a title
    ↓
Step 2: Paste DDL or upload ER diagram (optional)
    ↓
Step 3: Add each SQL view/SP — paste SQL, set what it feeds into
    ↓
Step 4: Paste the employee's explanation → SAI suggests entries
    ↓
Step 5: Review everything → Save All
    ↓
Ask SAI — now answers from this knowledge
```

---

## Tips

- **Name your blocks** — when adding SQL objects, give them a clear name (e.g. `GL Balance Check`) so Ask SAI can reference them by name
- **"Feeds Into"** is important — it builds the dependency graph that powers flow diagrams
- **Step 4 is optional** — you can skip the transcript and just save the SQL objects from Step 3
- **Run the wizard multiple times** — once per project or per major component (GL, Claims, Billing separately)
- **After the wizard** — you can still add individual entries via `+ Add Entry` with Content Blocks for anything the wizard didn't capture

---

*docs/Guided_KT_How_It_Works.md*
