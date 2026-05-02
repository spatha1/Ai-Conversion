# Agent Mapper — Full Flow Documentation

## Overview

The Agent Mapper generates Duck Creek Technologies (DCT) Extract Manuscript XML from natural-language instructions. It handles single and multi-field mappings, extend mode (adding to existing manuscripts), and three related pages:

| Page | Path | Purpose |
|------|------|---------|
| Agent Mapper | `/agent-mapper` | Generate new or extend existing manuscripts |
| Mapper Templates | `/agent-mapper/templates` | Browse/manage OOTB + custom templates |
| Mapping Assistant | `/mapping-assistant` | AI chat for DCT mapping questions |

---

## Core Pipeline (Agent Mapper)

```
User Instruction
      │
      ▼
[1] Intent Parser (gpt-4o-mini)
      │  Extracts: entity, field, source, type, lob
      │  Optional: key_source, name_source, desc_source (reference types)
      ▼
[2] Intent Validator
      │  Validates entity/type/lob (hard errors)
      │  Checks field against FIELD_REGISTRY (advisory warning only)
      │  Sets low_confidence flag if entity not in user input
      │  Reverse-lookup: suggests correct entity when field belongs elsewhere
      ▼
[3] Rule Engine
      │  Picks template: extra_party, extra_policy, dynamic, risk,
      │                  reference, base, controller
      │  Reads LOB_CONFIG → inherit, include
      ▼
[4] Template Engine
      │  Renders full ManuScript XML (create mode)
      │  OR renders fieldMap elements (extend mode)
      │  extractRef = ENTITY_TARGET_MAP[entity] (table-level, not field-level)
      ▼
[5] XML Merger (extend mode only)
      │  Finds/creates <extractMap objectRef+extractRef>
      │  Updates fieldMaps in-place (or adds new), guards identical duplicates
      ▼
[6] DB Store → session_id
      │
      └─► ManuscriptResult { xml, grid, warnings, suggestions, tokens, latency, metadata }
```

---

## extractRef Rule

`extractRef` MUST reference the **target table**, never a field name. Canonical map:

| Entity | extractRef |
|--------|-----------|
| Policy | `Policy.Policy` |
| Risk | `Policy.InsuredObject` |
| Coverage | `Coverage.Coverage` |
| Account | `Policy.Account` |

This is enforced in `ENTITY_TARGET_MAP` in `template_engine.py` and imported by `rule_engine.py` and `intent_validator.py`.

---

## Template Selection Rules (Priority Order)

| Priority | Condition | Template |
|----------|-----------|----------|
| 1 | field starts with `_` | `dynamic` |
| 2 | type = `controller` | `controller` |
| 3 | entity = `Risk` | `risk` |
| 4 | type = `extra` | `extra_party` or `extra_policy` |
| 5 | type = `reference` | `reference` |
| 6 | default | `base` |

---

## LOB Configuration

```python
LOB_CONFIG = {
    "Auto": {
        "Risk":     { "inherit": "DuckCreekTech_Risk_ExtractMap",     "include": ["Policy", "SharedMaps_ReferenceTables"] },
        "Policy":   { "inherit": None,                                  "include": ["Policy", "SharedMaps_ReferenceTables"] },
        "Account":  { "inherit": "DuckCreekTech_Account_ExtractMap",  "include": ["Policy", "SharedMaps_ReferenceTables"] },
        "Coverage": { "inherit": "DuckCreekTech_Coverage_ExtractMap", "include": ["Policy", "SharedMaps_ReferenceTables"] },
    },
    "Property": { ... },
    "GL":       { ... },
}
```

---

## Examples

### Example 1 — Create: Single Field (Risk Auto)

**Input:**
```
Add VehicleVIN to Risk for Auto
```

**AI Output:**
```json
[{"entity":"Risk","field":"VehicleVIN","source":"VehicleVIN","type":"risk","lob":"Auto"}]
```

**Generated XML:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ManuScript>
  <include manuscriptRef="Policy"/>
  <include manuscriptRef="SharedMaps_ReferenceTables"/>
  <properties manuscriptID="Auto_Risk_risk" ... inherited="DuckCreekTech_Risk_ExtractMap"/>
  <Extract>
    <extractMap objectRef="Risk" extractRef="Policy.InsuredObject">
      <fieldMap name="InsuredObjectKey" fieldRef="Risk.Id"/>
      <fieldMap name="VehicleVIN" fieldRef="Risk.VehicleVIN"/>
    </extractMap>
  </Extract>
</ManuScript>
```

---

### Example 2 — Create: Multi-Field (Policy)

**Input:**
```
Add PolicyNumber and EffectiveDate to Policy
```

**AI Output:**
```json
[
  {"entity":"Policy","field":"PolicyNumber","source":"PolicyNumber","type":"base","lob":"Auto"},
  {"entity":"Policy","field":"EffectiveDate","source":"EffectiveDate","type":"base","lob":"Auto"}
]
```

**Generated XML** (both fields merged into one extractMap):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ManuScript>
  <include manuscriptRef="Policy"/>
  <include manuscriptRef="SharedMaps_ReferenceTables"/>
  <properties manuscriptID="Auto_Policy_base" .../>
  <Extract>
    <extractMap objectRef="Policy" extractRef="Policy.Policy">
      <fieldMap name="PolicyNumber" fieldRef="PolicyNumber"/>
      <fieldMap name="EffectiveDate" fieldRef="EffectiveDate"/>
    </extractMap>
  </Extract>
</ManuScript>
```

> Note: `extractRef="Policy.Policy"` — the target **table**, not the field name.

---

### Example 3 — Create: Reference Mapping with Custom Sources

**Input:**
```
Add TypeCode to Coverage, use TypeDescription as name and TypeLongDesc as desc
```

**AI Output:**
```json
[{
  "entity": "Coverage",
  "field": "TypeCode",
  "source": "TypeCode",
  "type": "reference",
  "lob": "Auto",
  "name_source": "TypeDescription",
  "desc_source": "TypeLongDesc"
}]
```

**Generated XML** (full manuscript, reference template):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ManuScript>
  <include manuscriptRef="Policy"/>
  <include manuscriptRef="SharedMaps_ReferenceTables"/>
  <properties
    manuscriptID="Auto_Coverage_reference"
    versionID="ExtractMap"
    versionDate="2026-01-01"
    version="1"
    boolean="1"
    fieldCache="1"
    shortCircuitCond="1"
    caption="Auto Coverage reference"
    inherited="DuckCreekTech_Coverage_ExtractMap"
  />
  <Extract>
    <extractMap objectRef="Coverage" extractRef="Coverage.Coverage" preFilter="TypeCode != ''">
      <fieldMap name="TypeCodeKey"  expression="substring(TypeCode, 1, 50)"/>
      <fieldMap name="TypeCode"     expression="substring(TypeCode, 1, 50)"/>
      <fieldMap name="TypeCodeName" path="TypeDescription"/>
      <fieldMap name="TypeCodeDesc" path="TypeLongDesc"/>
    </extractMap>
  </Extract>
</ManuScript>
```

> Note: `extractRef="Coverage.Coverage"` — the target table for Coverage entity, not the field `Coverage.TypeCode`.

---

### Example 4 — Wrong Entity: Suggestion Flow

**Input:**
```
Add policynumber and vehiclevin for Account
```

**AI Output:**
```json
[
  {"entity":"Account","field":"policynumber","source":"policynumber","type":"base","lob":"Auto"},
  {"entity":"Account","field":"vehiclevin",  "source":"vehiclevin",  "type":"base","lob":"Auto"}
]
```

**Validator fires:**
- `warnings`: `["Unknown field 'policynumber' for entity 'Account'...", "Unknown field 'vehiclevin'..."]`
- `suggestions`: `[{field:"PolicyNumber", suggested_entity:"Policy"}, {field:"VehicleVIN", suggested_entity:"Risk"}]`

**Generated XML (Account path — user keeps as-is):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ManuScript>
  <include manuscriptRef="Policy"/>
  <include manuscriptRef="SharedMaps_ReferenceTables"/>
  <properties manuscriptID="Auto_Account_base" inherited="DuckCreekTech_Account_ExtractMap" .../>
  <Extract>
    <extractMap objectRef="Account" extractRef="Policy.Account">
      <fieldMap name="policynumber" fieldRef="policynumber"/>
      <fieldMap name="vehiclevin"   fieldRef="vehiclevin"/>
    </extractMap>
  </Extract>
</ManuScript>
```

**UI shows:**
```
⚠ Unknown field 'policynumber' for entity 'Account'    [warning chip]
⚠ Unknown field 'vehiclevin' for entity 'Account'      [warning chip]

💡 'PolicyNumber' is usually mapped under 'Policy'     [Change to Policy] [✕]
💡 'VehicleVIN' is usually mapped under 'Risk'          [Change to Risk]   [✕]
```

---

### Example 5 — Extend Existing Manuscript

**Input (with existing XML pasted or uploaded):**
```
Add GarageState to the Risk manuscript
```

The merger finds the existing `<extractMap objectRef="Risk" ...>` and injects:
```xml
<fieldMap name="GarageState" fieldRef="Risk.GarageState"/>
```

Duplicate guard: if `fieldMap name="GarageState"` already exists, it is skipped (not added twice).

---

## Warning System

Four types of warnings are displayed as chips in the UI:

| Warning | Condition | Blocking? | Example |
|---------|-----------|-----------|---------|
| **entity inferred** | Entity word not in user input | No | Input: "Add PolicyNumber" → Policy inferred |
| **unknown field** | Field not in FIELD_REGISTRY | No (advisory) | "Add FooBar to Policy" → warning |
| **LOB defaulted** | LOB not Auto/Property/GL | No | "... for Marine" → defaulted to Auto |
| **XML/grid mismatch** | Post-merge consistency check detects drift | No | fieldMap in XML not reflected in grid |

All warnings are **non-blocking** — generation always proceeds. Orange border on intent card + `low_confidence` flag on `entity inferred`. The entity confirmation RadioGroup lets users correct inferred entities and re-run.

When an **unknown field** warning fires AND the field is recognized in a different entity's registry, a **suggestion** is also produced (see below).

---

## FIELD_REGISTRY (advisory only)

`FIELD_REGISTRY` is an **advisory whitelist** — it triggers a warning chip but never blocks generation. Its purpose is surfacing likely typos or incorrect field names, not gatekeeping.

Valid fields are not exhaustive; any field outside the registry that is intentional should simply be ignored.

Covers ~30 well-known DCT fields per entity:

- **Policy**: PolicyNumber, EffectiveDate, ExpirationDate, PolicyType, PolicyState, CarrierCode, ProductCode, ...
- **Risk**: VIN, VehicleVIN, Model, Year, Make, VehicleType, GarageState, GarageZip, ...
- **Account**: ClientID, FirstName, LastName, DateOfBirth, AccountType, RelationshipCode, ...
- **Coverage**: CoverageCode, CoverageType, Limit, Deductible, CoverageGroup, CoverageCategory, ...

At module load time a **reverse lookup table** (`_FIELD_TO_ENTITIES`) is built from `FIELD_REGISTRY`. It maps every field (lowercased) to the entity it belongs to. This powers the suggestion system.

---

## Intelligent Entity Suggestions

### What it does

When a field is mapped to the wrong entity, the system **does not block**. Instead it:

1. Generates the XML normally (Allow)
2. Fires the existing `unknown field` warning chip (Warn)
3. Emits a structured `suggestion` that tells the user where the field actually belongs (Suggest)

Design principle: **business logic is custom** — sometimes users intentionally map a Risk field under Account. The system must never gatekeep. It surfaces the likely mistake and offers a one-click fix.

### How it works (step by step)

```
User: "Add policynumber and vehiclevin for Account"
                │
                ▼
[Intent Validator] validates entity=Account for each field
                │
                ├─ field "policynumber" not in Account.FIELD_REGISTRY
                │     → warning: "Unknown field 'policynumber' for entity 'Account'"
                │     → _FIELD_TO_ENTITIES["policynumber"] = [("PolicyNumber", "Policy")]
                │     → suggestion: { field: "PolicyNumber", current: "Account", suggested: "Policy" }
                │
                └─ field "vehiclevin" not in Account.FIELD_REGISTRY
                      → warning: "Unknown field 'vehiclevin' for entity 'Account'"
                      → _FIELD_TO_ENTITIES["vehiclevin"] = [("VehicleVIN", "Risk")]
                      → suggestion: { field: "VehicleVIN", current: "Account", suggested: "Risk" }
                │
                ▼
[XML Generator] generates Account XML normally (no block)
                │
                ▼
ManuscriptResult {
  warnings:    ["Unknown field 'policynumber'...", "Unknown field 'vehiclevin'..."],
  suggestions: [
    { field: "PolicyNumber", current_entity: "Account", suggested_entity: "Policy",
      message: "'PolicyNumber' is usually mapped under 'Policy'" },
    { field: "VehicleVIN",   current_entity: "Account", suggested_entity: "Risk",
      message: "'VehicleVIN' is usually mapped under 'Risk'" }
  ]
}
```

### Reverse lookup implementation

`_FIELD_TO_ENTITIES` is built once at import time in `intent_validator.py`:

```python
_FIELD_TO_ENTITIES: dict[str, list[tuple[str, str]]] = {}
for _entity, _fields in FIELD_REGISTRY.items():
    for _f in _fields:
        _FIELD_TO_ENTITIES.setdefault(_f.lower(), []).append((_f, _entity))
```

The lookup is **case-insensitive** — the user can type `vehiclevin`, `VehicleVin`, or `VEHICLEVIN` and all resolve to `("VehicleVIN", "Risk")`. The suggestion always uses the canonical casing from the registry.

Only fires when:
- The field is unknown for the current entity (warning already produced)
- AND the field IS found in a different entity's registry
- Does NOT fire when the field is simply not in any registry (genuine unknown)

### UI behaviour

The suggestions render as dismissible info alerts below the warnings banner:

```
[💡] 'PolicyNumber' is usually mapped under 'Policy'   [Change to Policy]  [✕]
[💡] 'VehicleVIN' is usually mapped under 'Risk'        [Change to Risk]    [✕]
```

**[Change to Entity]** — replaces the entity name in the instruction field (case-insensitive regex) and immediately re-runs generation. If the entity word is not found in the instruction, appends `for {suggested_entity}`.

**[✕]** — dismisses the suggestion locally. The XML generated under the original entity is kept. No server call.

Component: `SuggestionBanner` in `AgentMapperPage.tsx`. Dismissed suggestions are tracked in a local `Set<string>` keyed by `{field}::{current_entity}` — they reappear on the next generation if the same pattern recurs.

### What gets generated (both paths)

**Path A — User ignores suggestion, keeps Account:**
```xml
<extractMap objectRef="Account" extractRef="Policy.Account">
  <fieldMap name="policynumber" fieldRef="policynumber"/>
  <fieldMap name="vehiclevin"   fieldRef="vehiclevin"/>
</extractMap>
```
Both fields land under `Policy.Account`. Valid XML. Business logic choice.

**Path B — User clicks "Change to Risk" on VehicleVIN suggestion:**

Instruction becomes `"Add policynumber and vehiclevin for Risk"` → re-runs → entity is now Risk → uses `risk` template → `extractRef="Policy.InsuredObject"`:
```xml
<extractMap objectRef="Risk" extractRef="Policy.InsuredObject">
  <fieldMap name="InsuredObjectKey" fieldRef="Risk.Id"/>
  <fieldMap name="RiskState"        expression="(Risk/StateCode[. != ''])[1]"/>
  <fieldMap name="AddressKey"       fieldRef="Risk.RiskAddressKey"/>
  <fieldMap name="InsuredObjectNumber" expression="position()"/>
  <fieldMap name="policynumber"     fieldRef="Risk.policynumber"/>
  <fieldMap name="vehiclevin"       fieldRef="Risk.vehiclevin"/>
</extractMap>
```

### Suggestion vs Warning — decision table

| Scenario | Warning | Suggestion | Reason |
|----------|---------|------------|--------|
| `VehicleVIN` for `Account` | Yes | Yes → Risk | Field found in Risk registry |
| `PolicyNumber` for `Account` | Yes | Yes → Policy | Field found in Policy registry |
| `FooBar` for `Policy` | Yes | No | Field not in any registry |
| `PolicyNumber` for `Policy` | No | No | Field is correct |
| `GarageState` for `Risk` | No | No | Field is correct |
| `ClientID` for `Account` | No | No | Field is correct |

---

## Template Library

### Seed OOTB Templates

Click **Seed OOTB** on the Mapper Templates page, or call:
```
POST /api/agent-mapper/templates/seed
```

Reads all `*.xml` files from `samples/agent_mapper/` and inserts them into `conversion_agent_mapper_templates`.

### OOTB Sample Files

| File | manuscriptID | Entity | LOB | Type |
|------|-------------|--------|-----|------|
| 01_extra_party.xml | Auto_Account_extra | Account | Auto | extra |
| 02_extra_policy.xml | Auto_Policy_extra | Policy | Auto | extra |
| 03_dynamic.xml | Auto_Policy_dynamic | Policy | Auto | dynamic |
| 04_risk_auto.xml | Auto_Risk_risk | Risk | Auto | risk |
| 05_risk_property.xml | Property_Risk_risk | Risk | Property | risk |
| 06_risk_gl.xml | GL_Risk_risk | Risk | GL | risk |
| 07_reference.xml | Auto_Coverage_reference | Coverage | Auto | reference |
| 08_base.xml | Auto_Policy_base | Policy | Auto | base |
| 09_controller.xml | Auto_Policy_controller | Policy | Auto | controller |

### "Use as Base" Flow

1. Click **→** (arrow) on any template in the table
2. Template XML is stored in `sessionStorage('agentmapper_base_xml')`
3. Navigate to `/agent-mapper`
4. Page loads, reads sessionStorage, pre-populates Extend mode textarea
5. User adds their instruction and generates

---

## Mapping Assistant

### How it Works (v1 — OOTB samples only)

```
User Question
      │
      ▼
[1] Load OOTB samples (≤3 relevant files based on entity/type keywords)
[2] Include session context (if toggled + last result exists)
      │
      ▼
[3] Build system prompt with OOTB context injected
[4] Include last 6 turns of conversation history
[5] Call gpt-4o-mini
      │
      ▼
AskResponse { answer, sources[], tokens_in, tokens_out, latency_ms }
```

> **v1 scope**: Only OOTB XML samples are used for context. SAI KB cosine search is disabled.
> This keeps answers grounded in the canonical OOTB patterns rather than custom-uploaded knowledge.
> KB search can be re-enabled in `_build_system_prompt()` in `api/routers/mapping_assistant.py`.

### Session Context Toggle

When **Session context** is enabled, the assistant receives the last Agent Mapper result:
```
=== CURRENT SESSION CONTEXT ===
Entity: Risk
Field: VehicleVIN
Template: Auto_Risk_risk
Generated XML: ...
```

This allows context-specific answers like:
> "Looking at your Risk manuscript for Auto, the `inherit` is `DuckCreekTech_Risk_ExtractMap`..."

Agent Mapper writes the last result to `sessionStorage('agentmapper_last_result')` on every successful generation.

### "Use in Mapper" Button

Every assistant response (except the welcome message) shows a **Use in Mapper →** button.

**Flow:**
1. User asks: _"How do I map CoverageCode for Coverage using reference template?"_
2. Assistant replies with guidance
3. User clicks **Use in Mapper →**
4. The original user question is stored in `sessionStorage('agentmapper_intent_prefill')`
5. Page navigates to `/agent-mapper`
6. Agent Mapper reads the prefill on mount, sets the instruction field, and auto-triggers generation

This creates a seamless research → generation loop: ask the assistant, get guidance, immediately run it.

### Prompt Override

Category in DB: `mapping_assistant`
Admin → Prompt Templates → category = `mapping_assistant` → edit system prompt.

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agent-mapper/generate` | POST | Generate/extend manuscript |
| `/api/agent-mapper/sessions` | GET | List recent sessions |
| `/api/agent-mapper/sessions/{id}` | GET | Session detail |
| `/api/agent-mapper/templates` | GET | List templates |
| `/api/agent-mapper/templates/{id}` | GET | Template detail |
| `/api/agent-mapper/templates` | POST | Create custom template |
| `/api/agent-mapper/templates/{id}` | PUT | Update template |
| `/api/agent-mapper/templates/{id}` | DELETE | Disable template |
| `/api/agent-mapper/templates/seed` | POST | Seed OOTB from samples/ |
| `/api/mapping-assistant/ask` | POST | Chat with Mapping Assistant |

### `POST /api/agent-mapper/generate` — Response Shape

```json
{
  "session_id":     123,
  "generated_xml":  "<?xml ...",
  "grid":           [{ "entity": "Risk", "target_field": "VehicleVIN", "operation": "added", ... }],
  "warnings":       ["Unknown field 'vehiclevin' for entity 'Account'..."],
  "suggestions": [
    {
      "field":            "VehicleVIN",
      "current_entity":   "Account",
      "suggested_entity": "Risk",
      "message":          "'VehicleVIN' is usually mapped under 'Risk'"
    }
  ],
  "metadata": {
    "template_id":     null,
    "template_source": "engine",
    "extract_refs":    ["Policy.Account"]
  },
  "tokens_in": 210, "tokens_out": 85, "latency_ms": 1240
}
```

**`grid[].operation`** — present only on newly added/updated rows: `"added"` | `"updated"`. Absent on pre-existing rows.

**`metadata.template_source`** — `"custom"` when a library template was used as base; `"engine"` when the hardcoded Python renderer was used.

**`metadata.extract_refs`** — all `extractRef` values found in the final XML (one per `<extractMap>` block).

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `conversion_agent_mapper_sessions` | Session history (generated XML, grid, intents) |
| `conversion_agent_mapper_templates` | OOTB + custom template library |

---

## Template Library → Engine Connection

### 1. Create Mode — Custom Template Override
When generating in Create mode, after the rule engine selects `(lob, entity, mapping_type)`, the engine queries the DB:
- If a **custom** (non-OOTB) template matching that combination exists → uses it as the base XML and runs extend/merge on top
- If only OOTB templates exist → uses hardcoded Python-rendered template (preserves stock behaviour)
- This means: editing a custom `Auto_Risk_risk` template in the library changes how Risk Auto manuscripts are generated

### 2. Extend Mode — "From Library" Picker
In Agent Mapper → Extend Existing mode:
- **Upload XML** button — load any local `.xml` file
- **From Library** button — opens inline popover with all active templates; clicking one loads its XML without navigating away
- **Use as Base** on Templates page — stores XML in `sessionStorage('agentmapper_base_xml')` and redirects to Agent Mapper in Extend mode

### SAI KB Indexing (auto on create/seed)
When a template is created or seeded:
1. A `KnowledgeEntry` is created in `conversion_knowledge_entries` with the template XML as content
2. A `KnowledgeChunk` is created and embedded via OpenAI
3. `kb_entry_id` is stored on the template row (shown as `KB ✓` chip in the table)
4. The index is ready for when KB search is re-enabled in the Mapping Assistant (currently v1 OOTB-only)

---

## sessionStorage Keys

| Key | Written by | Read by | Purpose |
|-----|-----------|---------|---------|
| `agentmapper_base_xml` | Mapper Templates page | Agent Mapper (mount) | Pre-load Extend mode with a library template |
| `agentmapper_last_result` | Agent Mapper (on generate) | Mapping Assistant (context toggle) | Pass session context to assistant |
| `agentmapper_intent_prefill` | Mapping Assistant ("Use in Mapper") | Agent Mapper (mount) | Pre-populate instruction + auto-run |

---

## Adding New OOTB Templates

1. Create a new `*.xml` file in `samples/agent_mapper/`
2. Follow the naming convention: `{NN}_{description}.xml`
3. Include the `<properties manuscriptID="{LOB}_{Entity}_{type}">` attribute
4. Click **Seed OOTB** in the Mapper Templates page (existing templates are skipped)
5. Or call `POST /api/agent-mapper/templates/seed`

### Template Structure Reference

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ManuScript>
  <include manuscriptRef="Policy"/>
  <include manuscriptRef="SharedMaps_ReferenceTables"/>
  <properties
    manuscriptID="Auto_Risk_risk"
    versionID="ExtractMap"
    versionDate="2026-01-01"
    version="1"
    boolean="1"
    fieldCache="1"
    shortCircuitCond="1"
    caption="Auto Risk risk"
    inherited="DuckCreekTech_Risk_ExtractMap"
  />
  <Extract>
    <extractMap objectRef="Risk" extractRef="Policy.InsuredObject">
      <fieldMap name="InsuredObjectKey" fieldRef="Risk.Id"/>
      <fieldMap name="MyField"          fieldRef="Risk.MyField"/>
    </extractMap>
  </Extract>
</ManuScript>
```
