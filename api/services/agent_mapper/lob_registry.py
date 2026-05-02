from __future__ import annotations

# Known DCT manuscript refs — used for advisory warnings on unknown includes
KNOWN_MANUSCRIPT_REFS: frozenset[str] = frozenset({
    "Policy",
    "Party",
    "SharedMaps_ReferenceTables",
    "DuckCreekTech_PrivateFields_ExtractMap",
    "DuckCreekTech_Risk_ExtractMap",
    "DuckCreekTech_PropertyRisk_ExtractMap",
    "DuckCreekTech_GLRisk_ExtractMap",
    "DuckCreekTech_Account_ExtractMap",
    "DuckCreekTech_Coverage_ExtractMap",
})

LOB_CONFIG: dict[str, dict[str, dict[str, object]]] = {
    "Auto": {
        "Account":  {"inherit": None,                                  "include": ["Party", "SharedMaps_ReferenceTables"]},
        "Policy":   {"inherit": None,                                  "include": ["Policy", "SharedMaps_ReferenceTables"]},
        "Risk":     {"inherit": "DuckCreekTech_Risk_ExtractMap",       "include": ["Policy", "SharedMaps_ReferenceTables"]},
        "Coverage": {"inherit": None,                                  "include": ["Policy", "SharedMaps_ReferenceTables"]},
    },
    "Property": {
        "Account":  {"inherit": None,                                         "include": ["Party", "SharedMaps_ReferenceTables"]},
        "Policy":   {"inherit": None,                                         "include": ["Policy", "SharedMaps_ReferenceTables"]},
        "Risk":     {"inherit": "DuckCreekTech_PropertyRisk_ExtractMap",      "include": ["Policy", "SharedMaps_ReferenceTables"]},
        "Coverage": {"inherit": None,                                         "include": ["Policy", "SharedMaps_ReferenceTables"]},
    },
    "GL": {
        "Account":  {"inherit": None,                                 "include": ["Party", "SharedMaps_ReferenceTables"]},
        "Policy":   {"inherit": None,                                 "include": ["Policy", "SharedMaps_ReferenceTables"]},
        "Risk":     {"inherit": "DuckCreekTech_GLRisk_ExtractMap",    "include": ["Policy", "SharedMaps_ReferenceTables"]},
        "Coverage": {"inherit": None,                                 "include": ["Policy", "SharedMaps_ReferenceTables"]},
    },
}

DEFAULT_LOB = "Auto"


def resolve_lob_entity_config(lob: str | None, entity: str) -> dict[str, object]:
    normalized_lob = (lob or DEFAULT_LOB).strip() or DEFAULT_LOB
    lob_bucket     = LOB_CONFIG.get(normalized_lob) or LOB_CONFIG[DEFAULT_LOB]
    entity_bucket  = lob_bucket.get(entity) or LOB_CONFIG[DEFAULT_LOB].get(entity, {})
    return {
        "lob":     normalized_lob if normalized_lob in LOB_CONFIG else DEFAULT_LOB,
        "inherit": entity_bucket.get("inherit"),
        "include": list(entity_bucket.get("include", [])),
    }
