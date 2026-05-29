# SAI Knowledge Hub — Quick KT Steps
**URL:** http://104.211.112.63

---

## Before You Start — Gather These Files
```
□ All CREATE TABLE scripts (staging tables)
□ All CREATE VIEW scripts (one per XML group)
□ GenerateSmallXML_SP full code
□ AssembleBigXML_SP full code
□ Your notes explaining how it all works
```

---

## Step 1 — Create a Schema
> SAI Knowledge → **Schemas tab** → **New KB Schema**

- Name: e.g. `Policy Conversion`
- Pick a color → **Create**

---

## Step 2 — Import the DB Schema
> Schemas tab → **Import DB Schema**

1. Enter the same name as Step 1
2. Paste ALL your DDL scripts (no size limit)
3. Click **Import & Embed**
4. Watch the progress:
   ```
   [1/7] Embedding Policyattach_1 (63 cols)…
   [2/7] Embedding T_Policyattach_000 (18 cols)…
   ✅ Done! 7 tables, 139 columns embedded.
   ```

---

## Step 3 — Use the Guided KT Wizard
> Knowledge Base tab → **🎓 Guided KT**

| Step | What to do |
|------|-----------|
| **Project Setup** | Select schema from Step 1, add title & description |
| **Upload Schema** | Skip (already done in Step 2) or re-paste DDL |
| **SQL Objects** | Add each view and SP — paste SQL, name it, pick what it feeds into |
| **KT Session** | Paste your plain-English explanation → click "Create Session & Analyse" |
| **Review & Save** | Check the pipeline flow → click **Save All** |

### For each SQL Object, provide:
- **Name** — e.g. `PolicyHeader_VW`, `GenerateSmallXML_SP`
- **Type** — View / Stored Procedure / Function
- **SQL Code** — paste the full SQL
- **Purpose** — what it does in one sentence
- **XML Group** — which XML group it produces (e.g. `PolicyHeader`, `Claims`, `BIG_XML`)
- **Feeds Into** — which SP or object it connects to

### For Stored Procedures, also provide:
- **Source View** — e.g. `PolicyHeader_VW`
- **Target Table** — e.g. `xml_output_policy`
- **Formula / {} Template** — e.g. `SELECT {policy_id}, {policy_number} FROM {source_view}`

---

## Step 4 — Add Extra Detail (optional)
> Knowledge Base tab → **+ Add Entry**

For anything the wizard didn't capture:
1. Schema: `Policy Conversion` | Type: `QueryExample`
2. **Add Block → SQL Query** — paste the SQL, name it
3. **Add Block → Text** — explain the `{}` placeholders and mapping
4. Click **🔍 Preview AI Understanding** — see what SAI understood
5. Click **Process & Save**

---

## Step 5 — Test SAI
> **Ask SAI tab** → select **DB Schema: Policy Conversion**

Try these questions:

| Format chip | Question to ask |
|------------|----------------|
| **Flow Diagram** | "Show the full pipeline from staging to big XML" |
| **Answer** | "What columns are in Policyattach_1?" |
| **Generate** | "Write SQL to extract PolicyHeader from staging" |
| **Teach Me** | "Explain how the {} placeholder SP works" |
| **Implementation Plan** | "How do I add a new XML group to the conversion?" |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Not authenticated" error | Log in again, then retry |
| Import shows no progress | Paste DDL in the text area (not just upload a file) |
| SAI says "I don't know" | Make sure DB Schema chip is selected in Ask SAI |
| Entries not showing | Click Rebuild Embeddings in Knowledge Base tab |

---

*SAI Knowledge Hub — docs/SAI_KT_Steps.md*
