from __future__ import annotations
import re

ALLOWED_ENTITIES = {"Account", "Policy", "Risk", "Coverage"}

# Canonical extractRef per entity — validated against this map
ENTITY_TARGET_MAP: dict[str, str] = {
    "Policy":   "Policy.Policy",
    "Risk":     "Policy.InsuredObject",
    "Coverage": "Coverage.Coverage",
    "Account":  "Policy.Account",
}
ALLOWED_TYPES    = {"extra", "base", "dynamic", "reference", "risk", "controller"}
ALLOWED_LOBS     = {"Auto", "Property", "GL"}
DEFAULT_LOB      = "Auto"

# Optional whitelist — only entities listed here are checked; others pass freely.
FIELD_REGISTRY: dict[str, set[str]] = {
    "Policy": {
        "PolicyNumber", "EffectiveDate", "ExpirationDate", "PremiumAmount",
        "PolicyStatus", "CancellationDate", "RenewalDate", "WrittenPremium",
        "TransactionDate", "BillingType", "PolicyType", "PolicyState",
        "CarrierCode", "ProductCode", "TermCode", "RenewalCode",
        "CancellationCode", "BillingState", "AgentCode", "BrokerCode",
        "UnderwriterCode", "CompanyCode", "DivisionCode", "ProgramCode",
        "SourceCode", "ChannelCode", "PolicyForm", "PolicyVersion",
        "InceptionDate", "AuditCode", "PayPlanCode", "BillToCode",
    },
    "Risk": {
        "VIN", "VehicleVIN", "Model", "Year", "Make", "BodyStyle",
        "GrossVehicleWeight", "ModelYear", "RiskState", "VehicleType",
        "RegistrationState", "OdometerReading", "GarageState", "GarageZip",
        "VehicleUse", "AnnualMileage", "VehicleValue", "VehicleAge",
        "VehicleSymbol", "AntiTheftCode", "PassiveRestraint", "VehicleCode",
        "ClassCode", "RatingTerritoryCode", "DriverAssignCode", "FleetCode",
        "LienholderCode", "LeasedVehicle", "BusinessUse", "FarmUse",
    },
    "Account": {
        "ClientID", "FirstName", "LastName", "DateOfBirth", "TaxID",
        "AccountStatus", "EmailAddress", "PhoneNumber", "MiddleName",
        "Suffix", "Gender", "MaritalStatus", "DriverLicenseNumber",
        "DriverLicenseState", "OccupationCode", "EducationCode",
        "AccountType", "AccountCode", "RelationshipCode", "LanguageCode",
        "PreferredContact", "DoNotContact", "AccountSource",
    },
    "Coverage": {
        "CoverageCode", "CoverageType", "CoverageStatus", "Limit",
        "Deductible", "PremiumAmount", "SubLimit", "CoverageForm",
        "CoverageSymbol", "WaiverCode", "ExclusionCode", "EndorsementCode",
        "RatingCode", "ClassCode", "CoverageGroup", "CoverageCategory",
        "EffectiveDate", "ExpirationDate", "SplitLimit", "CombinedLimit",
        "AggregateLimit", "OccurrenceLimit", "RetroDate",
    },
}


def _entity_explicit(entity: str, user_input: str) -> bool:
    """True if entity name literally appears in the user instruction."""
    return bool(re.search(re.escape(entity), user_input, re.IGNORECASE))


def validate_one(intent: dict, user_input: str = "") -> tuple[dict, list[str]]:
    if not isinstance(intent, dict):
        raise ValueError("Each intent must be a JSON object")

    warnings: list[str] = []

    entity = (intent.get("entity") or "").strip()
    field  = (intent.get("field")  or "").strip()
    mtype  = (intent.get("type")   or "base").strip()
    source = (intent.get("source") or field).strip()
    lob    = (intent.get("lob")    or DEFAULT_LOB).strip() or DEFAULT_LOB

    # Pass through optional reference sources unchanged
    key_source  = intent.get("key_source")
    name_source = intent.get("name_source")
    desc_source = intent.get("desc_source")

    if entity not in ALLOWED_ENTITIES:
        raise ValueError(f"Unsupported entity: '{entity}'. Must be one of {sorted(ALLOWED_ENTITIES)}.")
    if mtype not in ALLOWED_TYPES:
        raise ValueError(f"Unsupported type: '{mtype}'. Must be one of {sorted(ALLOWED_TYPES)}.")

    # LOB fallback warning
    if lob not in ALLOWED_LOBS:
        warnings.append(f"LOB '{lob}' not recognised — defaulted to {DEFAULT_LOB}.")
        lob = DEFAULT_LOB

    if mtype != "controller" and not field:
        raise ValueError("field is required for non-controller mappings")
    if mtype != "controller" and not source:
        raise ValueError("source is required for non-controller mappings")

    # Entity confidence: warn when entity was not explicitly stated
    low_confidence = False
    if user_input and not _entity_explicit(entity, user_input):
        low_confidence = True
        warnings.append(
            f"Entity '{entity}' was inferred from context — please confirm it is correct."
        )

    # Field registry: warn on unknown field (non-blocking)
    registry = FIELD_REGISTRY.get(entity)
    if registry and field and field not in registry:
        warnings.append(f"Unknown field '{field}' for entity '{entity}' — not in known field list.")

    # extractRef validation: warn if intent source looks like a field-level ref
    expected_target = ENTITY_TARGET_MAP.get(entity)
    if expected_target and source and "." in source:
        # e.g. source="PolicyNumber.something" when it should be a simple field name
        src_prefix = source.split(".")[0]
        if src_prefix == field:
            warnings.append(
                f"Source '{source}' looks like a field-level path. "
                f"extractRef should target '{expected_target}', not a field name."
            )

    result: dict = {
        "entity": entity, "field": field, "source": source,
        "type": mtype, "lob": lob,
        "low_confidence": low_confidence,
    }
    if key_source  is not None: result["key_source"]  = key_source
    if name_source is not None: result["name_source"] = name_source
    if desc_source is not None: result["desc_source"] = desc_source

    return result, warnings


def validate_intent(intent: dict) -> dict:
    """Single-intent validation — backwards compatibility (warnings discarded)."""
    validated, _ = validate_one(intent)
    return validated


def validate_intents(intents: list[dict], user_input: str = "") -> tuple[list[dict], list[str]]:
    if not intents:
        raise ValueError("At least one field mapping is required.")
    all_warnings: list[str] = []
    results: list[dict] = []
    for i in intents:
        validated, warns = validate_one(i, user_input)
        results.append(validated)
        all_warnings.extend(warns)
    return results, all_warnings
