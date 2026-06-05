-- ============================================================
-- LegacyInsurance Reconciliation & Validation Queries
-- Use these in Data Workbench Testing / Recon tab
-- ============================================================

USE LegacyInsurance;
GO

-- ── Row Count Audit (all tables) ──────────────────────────────
SELECT 'PolicyMaster'       AS TableName, COUNT(*) AS RowCount FROM legacy.PolicyMaster   UNION ALL
SELECT 'PolicyTerm',                      COUNT(*)             FROM legacy.PolicyTerm      UNION ALL
SELECT 'PolicyTransaction',               COUNT(*)             FROM legacy.PolicyTransaction UNION ALL
SELECT 'NamedInsured',                    COUNT(*)             FROM legacy.NamedInsured    UNION ALL
SELECT 'Address',                         COUNT(*)             FROM legacy.Address         UNION ALL
SELECT 'Location',                        COUNT(*)             FROM legacy.Location        UNION ALL
SELECT 'Vehicle',                         COUNT(*)             FROM legacy.Vehicle         UNION ALL
SELECT 'Driver',                          COUNT(*)             FROM legacy.Driver          UNION ALL
SELECT 'Coverage',                        COUNT(*)             FROM legacy.Coverage        UNION ALL
SELECT 'CoverageLimit',                   COUNT(*)             FROM legacy.CoverageLimit   UNION ALL
SELECT 'CoverageDeductible',              COUNT(*)             FROM legacy.CoverageDeductible UNION ALL
SELECT 'Premium',                         COUNT(*)             FROM legacy.Premium         UNION ALL
SELECT 'Agency',                          COUNT(*)             FROM legacy.Agency          UNION ALL
SELECT 'Producer',                        COUNT(*)             FROM legacy.Producer        UNION ALL
SELECT 'PolicyNotes',                     COUNT(*)             FROM legacy.PolicyNotes;

-- ── Policy Counts by Status ───────────────────────────────────
SELECT
    pm.POL_STATUS,
    rs.STS_DESC,
    COUNT(*)                        AS PolicyCount,
    SUM(pm.ANN_PREM_AMT)            AS TotalAnnualPremium,
    AVG(pm.ANN_PREM_AMT)            AS AvgAnnualPremium,
    MIN(pm.ANN_PREM_AMT)            AS MinPremium,
    MAX(pm.ANN_PREM_AMT)            AS MaxPremium
FROM legacy.PolicyMaster pm
LEFT JOIN legacy.RefPolicyStatus rs ON pm.POL_STATUS = rs.STS_CD
GROUP BY pm.POL_STATUS, rs.STS_DESC
ORDER BY PolicyCount DESC;

-- ── Policy Counts by Line of Business ────────────────────────
SELECT
    pm.LOB_CD,
    rl.LOB_DESC,
    COUNT(*)                        AS PolicyCount,
    SUM(pm.ANN_PREM_AMT)            AS TotalPremium,
    AVG(pm.ANN_PREM_AMT)            AS AvgPremium
FROM legacy.PolicyMaster pm
LEFT JOIN legacy.RefLOB rl ON pm.LOB_CD = rl.LOB_CD
GROUP BY pm.LOB_CD, rl.LOB_DESC
ORDER BY PolicyCount DESC;

-- ── Policy Counts by State ────────────────────────────────────
SELECT
    pm.STATE_CD,
    rs.ST_NM,
    COUNT(*)                        AS PolicyCount,
    SUM(pm.ANN_PREM_AMT)            AS TotalPremium
FROM legacy.PolicyMaster pm
LEFT JOIN legacy.RefState rs ON pm.STATE_CD = rs.ST_CD
WHERE pm.POL_STATUS = 'A'
GROUP BY pm.STATE_CD, rs.ST_NM
ORDER BY PolicyCount DESC;

-- ── Premium Tier Distribution ─────────────────────────────────
SELECT
    CASE WHEN ANN_PREM_AMT > 10000 THEN 'Gold' ELSE 'Standard' END AS Tier,
    COUNT(*)                        AS PolicyCount,
    SUM(ANN_PREM_AMT)               AS TotalPremium,
    AVG(ANN_PREM_AMT)               AS AvgPremium,
    CAST(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() AS DECIMAL(5,2)) AS PctOfTotal
FROM legacy.PolicyMaster
WHERE POL_STATUS = 'A'
GROUP BY CASE WHEN ANN_PREM_AMT > 10000 THEN 'Gold' ELSE 'Standard' END;

-- ── Vehicle Count per Policy ──────────────────────────────────
SELECT
    VehiclesPerPolicy,
    COUNT(*)                        AS PolicyCount
FROM (
    SELECT POL_NO, COUNT(*) AS VehiclesPerPolicy
    FROM legacy.Vehicle
    GROUP BY POL_NO
) t
GROUP BY VehiclesPerPolicy
ORDER BY VehiclesPerPolicy;

-- ── Coverage Distribution ─────────────────────────────────────
SELECT
    c.CVG_CD,
    rc.CVG_TYP_DESC,
    COUNT(*)                        AS CoverageCount,
    SUM(CASE WHEN c.CVG_STS_CD='A' THEN 1 ELSE 0 END) AS ActiveCount
FROM legacy.Coverage c
LEFT JOIN legacy.RefCoverageType rc ON c.CVG_TYP_CD = rc.CVG_TYP_CD
GROUP BY c.CVG_CD, rc.CVG_TYP_DESC
ORDER BY CoverageCount DESC;

-- ── Driver Risk Distribution ──────────────────────────────────
SELECT
    ds.DRVR_STS_CD,
    rds.DRVR_STS_DESC,
    CASE WHEN ds.ACCIDENTS_CNT > 2 THEN 'HighRisk' ELSE 'Standard' END AS RiskCategory,
    COUNT(*)                        AS DriverCount,
    AVG(ds.ACCIDENTS_CNT)           AS AvgAccidents,
    AVG(ds.VIOLATIONS_CNT)          AS AvgViolations
FROM legacy.Driver ds
LEFT JOIN legacy.RefDriverStatus rds ON ds.DRVR_STATUS_CD = rds.DRVR_STS_CD
GROUP BY ds.DRVR_STS_CD, rds.DRVR_STS_DESC,
         CASE WHEN ds.ACCIDENTS_CNT > 2 THEN 'HighRisk' ELSE 'Standard' END
ORDER BY DriverCount DESC;

-- ── Premium Totals by Coverage Type ──────────────────────────
SELECT
    c.CVG_CD,
    SUM(p.WRTTN_PREM_AMT)           AS WrittenPremium,
    SUM(p.ERND_PREM_AMT)            AS EarnedPremium,
    SUM(p.TAX_AMT)                  AS TaxAmount,
    COUNT(DISTINCT p.POL_NO)        AS PolicyCount
FROM legacy.Premium p
JOIN legacy.Coverage c ON p.CVG_ID = c.CVG_ID
GROUP BY c.CVG_CD
ORDER BY WrittenPremium DESC;

-- ── Vehicle Make/Model Distribution ──────────────────────────
SELECT TOP 20
    VEH_MK,
    COUNT(*)                        AS VehicleCount,
    AVG(VEH_YR)                     AS AvgYear,
    MIN(VEH_YR)                     AS OldestYear,
    MAX(VEH_YR)                     AS NewestYear
FROM legacy.Vehicle
GROUP BY VEH_MK
ORDER BY VehicleCount DESC;

-- ── Agency Performance ────────────────────────────────────────
SELECT
    a.AGCY_CD,
    a.AGCY_NM,
    a.ST_CD,
    COUNT(pm.POL_NO)                AS PolicyCount,
    SUM(pm.ANN_PREM_AMT)            AS TotalPremium,
    a.COMM_PCT
FROM legacy.Agency a
LEFT JOIN legacy.PolicyMaster pm ON a.AGCY_CD = pm.AGCY_CD
GROUP BY a.AGCY_CD, a.AGCY_NM, a.ST_CD, a.COMM_PCT
ORDER BY TotalPremium DESC;

-- ── Data Quality: Policies missing required data ──────────────
SELECT
    'Missing VIN'           AS Issue,
    COUNT(*)                AS Count
FROM legacy.Vehicle WHERE VIN_NO IS NULL OR LEN(VIN_NO) <> 17
UNION ALL
SELECT 'Missing License Number', COUNT(*) FROM legacy.Driver WHERE LIC_NO IS NULL
UNION ALL
SELECT 'Zero Premium Policies',  COUNT(*) FROM legacy.PolicyMaster WHERE ANN_PREM_AMT = 0
UNION ALL
SELECT 'Expired but Active',     COUNT(*) FROM legacy.PolicyMaster
    WHERE POL_STATUS = 'A' AND EXP_DT < CAST(GETDATE() AS DATE)
UNION ALL
SELECT 'Missing Address',        COUNT(*) FROM legacy.PolicyMaster pm
    WHERE NOT EXISTS (SELECT 1 FROM legacy.Address a WHERE a.POL_NO = pm.POL_NO);

-- ── Policy Attach Readiness Check ────────────────────────────
-- Validates all required Duck Creek fields are populated
SELECT
    pm.POL_NO,
    pm.LOB_CD,
    pm.POL_STATUS,
    pm.STATE_CD,
    pm.ANN_PREM_AMT,
    ni.INSD_NM,
    a.ADDR_LN1,
    a.CITY_NM,
    a.ZIP_CD,
    CASE WHEN pm.POL_NO IS NULL       THEN 'FAIL: Missing POL_NO'
         WHEN pm.LOB_CD IS NULL       THEN 'FAIL: Missing LOB_CD'
         WHEN pm.STATE_CD IS NULL     THEN 'FAIL: Missing STATE_CD'
         WHEN pm.ANN_PREM_AMT <= 0   THEN 'FAIL: Zero premium'
         WHEN ni.INSD_NM IS NULL      THEN 'FAIL: Missing insured name'
         WHEN a.ADDR_LN1 IS NULL      THEN 'FAIL: Missing address'
         ELSE 'PASS' END              AS AttachReadiness
FROM legacy.PolicyMaster pm
LEFT JOIN legacy.NamedInsured ni ON pm.POL_NO = ni.POL_NO AND ni.INSD_TYP_CD = 'PRI'
LEFT JOIN legacy.Address a       ON pm.POL_NO = a.POL_NO  AND a.ADDR_TYP_CD  = 'MAIL'
WHERE pm.POL_STATUS = 'A'
ORDER BY AttachReadiness DESC, pm.POL_NO;
GO
