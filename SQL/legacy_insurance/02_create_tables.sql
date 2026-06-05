-- ============================================================
-- LegacyInsurance Table Definitions
-- Schema: legacy
-- Naming convention: 15-20 year old legacy system (XX_YY_ZZ)
-- ============================================================

USE LegacyInsurance;
GO

-- ── Reference Tables ────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RefPolicyStatus' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.RefPolicyStatus (
    STS_CD      CHAR(1)       NOT NULL CONSTRAINT PK_RefPolicyStatus PRIMARY KEY,
    STS_DESC    VARCHAR(50)   NOT NULL,
    STS_ACTV_FL CHAR(1)       NOT NULL DEFAULT 'Y',
    LAST_UPD_DT DATETIME      NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RefLOB' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.RefLOB (
    LOB_CD      VARCHAR(10)   NOT NULL CONSTRAINT PK_RefLOB PRIMARY KEY,
    LOB_DESC    VARCHAR(100)  NOT NULL,
    LOB_ACTV_FL CHAR(1)       NOT NULL DEFAULT 'Y',
    LAST_UPD_DT DATETIME      NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RefCoverageType' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.RefCoverageType (
    CVG_TYP_CD   VARCHAR(10)   NOT NULL CONSTRAINT PK_RefCoverageType PRIMARY KEY,
    CVG_TYP_DESC VARCHAR(100)  NOT NULL,
    MANDATORY_FL CHAR(1)       NOT NULL DEFAULT 'N',
    LAST_UPD_DT  DATETIME      NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RefState' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.RefState (
    ST_CD       CHAR(2)       NOT NULL CONSTRAINT PK_RefState PRIMARY KEY,
    ST_NM       VARCHAR(50)   NOT NULL,
    REGION_CD   VARCHAR(10)   NULL,
    LAST_UPD_DT DATETIME      NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RefVehicleType' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.RefVehicleType (
    VEH_TYP_CD   CHAR(3)       NOT NULL CONSTRAINT PK_RefVehicleType PRIMARY KEY,
    VEH_TYP_DESC VARCHAR(50)   NOT NULL,
    COMM_FL      CHAR(1)       NOT NULL DEFAULT 'N',
    LAST_UPD_DT  DATETIME      NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RefDriverStatus' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.RefDriverStatus (
    DRVR_STS_CD   CHAR(4)       NOT NULL CONSTRAINT PK_RefDriverStatus PRIMARY KEY,
    DRVR_STS_DESC VARCHAR(50)   NOT NULL,
    LAST_UPD_DT   DATETIME      NOT NULL DEFAULT GETDATE()
);

-- ── Agency & Producer ────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Agency' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Agency (
    AGCY_CD     VARCHAR(10)    NOT NULL CONSTRAINT PK_Agency PRIMARY KEY,
    AGCY_NM     VARCHAR(100)   NOT NULL,
    AGCY_TYP_CD VARCHAR(5)     NOT NULL,    -- IND=Independent, CAPT=Captive, DRCT=Direct
    ADDR_LN1    VARCHAR(100)   NULL,
    CITY_NM     VARCHAR(50)    NULL,
    ST_CD       CHAR(2)        NULL,
    ZIP_CD      VARCHAR(10)    NULL,
    PHN_NO      VARCHAR(15)    NULL,
    COMM_PCT    DECIMAL(5,2)   NOT NULL DEFAULT 10.00,
    EFF_DT      DATE           NOT NULL,
    EXP_DT      DATE           NULL,
    ACTV_FL     CHAR(1)        NOT NULL DEFAULT 'Y',
    ENTRY_DT    DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT DATETIME       NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Producer' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Producer (
    PROD_CD     VARCHAR(10)    NOT NULL CONSTRAINT PK_Producer PRIMARY KEY,
    AGCY_CD     VARCHAR(10)    NOT NULL,
    PROD_NM     VARCHAR(100)   NOT NULL,
    PROD_TYP_CD VARCHAR(5)     NOT NULL,    -- AGNT=Agent, BRKR=Broker
    LIC_NO      VARCHAR(20)    NULL,
    LIC_ST_CD   CHAR(2)        NULL,
    LIC_EXP_DT  DATE           NULL,
    PHN_NO      VARCHAR(15)    NULL,
    EML_ADDR    VARCHAR(100)   NULL,
    EFF_DT      DATE           NOT NULL,
    EXP_DT      DATE           NULL,
    ACTV_FL     CHAR(1)        NOT NULL DEFAULT 'Y',
    ENTRY_DT    DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_Producer_Agency FOREIGN KEY (AGCY_CD) REFERENCES legacy.Agency(AGCY_CD)
);

-- ── Core Policy Tables ───────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='PolicyMaster' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.PolicyMaster (
    POL_NO          VARCHAR(20)    NOT NULL CONSTRAINT PK_PolicyMaster PRIMARY KEY,
    POL_STATUS      CHAR(1)        NOT NULL DEFAULT 'P',   -- A/C/P/E/R
    LOB_CD          VARCHAR(10)    NOT NULL,               -- AUTO/HOME/GL/WC/COMM_AUTO
    POL_TYP_CD      VARCHAR(5)     NOT NULL DEFAULT 'STD', -- STD/SPEC/COMM
    CARRIER_CD      VARCHAR(10)    NOT NULL DEFAULT 'MAIN',
    PROG_CD         VARCHAR(10)    NULL,
    AGCY_CD         VARCHAR(10)    NULL,
    PROD_CD         VARCHAR(10)    NULL,
    UNDWTR_CD       VARCHAR(10)    NULL,
    EFF_DT          DATE           NOT NULL,
    EXP_DT          DATE           NOT NULL,
    CANCEL_DT       DATE           NULL,
    CANCEL_RSN_CD   VARCHAR(5)     NULL,
    STATE_CD        CHAR(2)        NOT NULL,
    ANN_PREM_AMT    DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    CMPNY_CD        VARCHAR(10)    NOT NULL DEFAULT 'LIC',
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    ENTRY_USR_ID    VARCHAR(20)    NOT NULL DEFAULT 'SYSTEM',
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_USR_ID VARCHAR(20)    NOT NULL DEFAULT 'SYSTEM',
    TIER_CD         VARCHAR(10)    NULL,                   -- GOLD/STD (derived)
    RENEWAL_NO      INT            NOT NULL DEFAULT 0,
    CONSTRAINT FK_PM_Agency FOREIGN KEY (AGCY_CD) REFERENCES legacy.Agency(AGCY_CD)
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='PolicyTerm' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.PolicyTerm (
    TERM_ID         INT            NOT NULL CONSTRAINT PK_PolicyTerm PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    TERM_NO         SMALLINT       NOT NULL DEFAULT 1,
    TERM_EFF_DT     DATE           NOT NULL,
    TERM_EXP_DT     DATE           NOT NULL,
    PRIOR_POL_NO    VARCHAR(20)    NULL,       -- renewal linkage
    PRIOR_TERM_ID   INT            NULL,
    TERM_PREM_AMT   DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    TERM_STS_CD     CHAR(1)        NOT NULL DEFAULT 'A',
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_PT_Policy FOREIGN KEY (POL_NO) REFERENCES legacy.PolicyMaster(POL_NO)
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='PolicyTransaction' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.PolicyTransaction (
    TRANS_ID        INT            NOT NULL CONSTRAINT PK_PolicyTransaction PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    TRANS_TYP_CD    VARCHAR(5)     NOT NULL,   -- NB/RN/EN/CN/RE/CH
    TRANS_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    TRANS_EFF_DT    DATE           NOT NULL,
    REASON_CD       VARCHAR(5)     NULL,
    CHNG_PREM_AMT   DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    PRIOR_PREM_AMT  DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    NEW_PREM_AMT    DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    USER_ID         VARCHAR(20)    NOT NULL DEFAULT 'SYSTEM',
    BATCH_NO        VARCHAR(20)    NULL,
    PROC_DT         DATETIME       NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_PTX_Policy FOREIGN KEY (POL_NO) REFERENCES legacy.PolicyMaster(POL_NO)
);

-- ── Insured / People ─────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='NamedInsured' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.NamedInsured (
    INSD_ID         INT            NOT NULL CONSTRAINT PK_NamedInsured PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    INSD_TYP_CD     VARCHAR(5)     NOT NULL DEFAULT 'PRI',  -- PRI/SEC/ADD
    INSD_NM         VARCHAR(100)   NOT NULL,                -- full name for commercial
    INSD_FRST_NM    VARCHAR(50)    NULL,
    INSD_LST_NM     VARCHAR(50)    NULL,
    SSN_TIN         VARCHAR(20)    NULL,                    -- masked: XXX-XX-1234
    DOB_DT          DATE           NULL,
    GNDR_CD         CHAR(1)        NULL,                    -- M/F/U
    MARITAL_STS_CD  CHAR(1)        NULL,                    -- S/M/D/W
    OCC_CD          VARCHAR(10)    NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_NI_Policy FOREIGN KEY (POL_NO) REFERENCES legacy.PolicyMaster(POL_NO)
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Address' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Address (
    ADDR_ID         INT            NOT NULL CONSTRAINT PK_Address PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    ADDR_TYP_CD     VARCHAR(5)     NOT NULL DEFAULT 'MAIL', -- MAIL/RISK/BILL/GAR
    ADDR_LN1        VARCHAR(100)   NOT NULL,
    ADDR_LN2        VARCHAR(100)   NULL,
    CITY_NM         VARCHAR(50)    NOT NULL,
    ST_CD           CHAR(2)        NOT NULL,
    ZIP_CD          VARCHAR(10)    NOT NULL,
    CNTY_CD         VARCHAR(10)    NULL,
    CTRY_CD         CHAR(3)        NOT NULL DEFAULT 'USA',
    GEOCODE_LAT     DECIMAL(10,7)  NULL,
    GEOCODE_LNG     DECIMAL(10,7)  NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_ADDR_Policy FOREIGN KEY (POL_NO) REFERENCES legacy.PolicyMaster(POL_NO)
);

-- ── Location ─────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Location' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Location (
    LOC_ID          INT            NOT NULL CONSTRAINT PK_Location PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    LOC_NO          SMALLINT       NOT NULL DEFAULT 1,
    LOC_DESC        VARCHAR(200)   NULL,
    ADDR_ID         INT            NULL,
    BLDG_TYP_CD     VARCHAR(5)     NULL,
    CNST_TYP_CD     VARCHAR(5)     NULL,
    YR_BUILT        SMALLINT       NULL,
    SQ_FT           INT            NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_LOC_Policy  FOREIGN KEY (POL_NO)   REFERENCES legacy.PolicyMaster(POL_NO),
    CONSTRAINT FK_LOC_Address FOREIGN KEY (ADDR_ID)  REFERENCES legacy.Address(ADDR_ID)
);

-- ── Vehicle ──────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Vehicle' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Vehicle (
    VEH_ID          INT            NOT NULL CONSTRAINT PK_Vehicle PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    VEH_NO          SMALLINT       NOT NULL DEFAULT 1,
    VEH_YR          SMALLINT       NOT NULL,
    VEH_MK          VARCHAR(30)    NOT NULL,
    VEH_MDL         VARCHAR(30)    NOT NULL,
    VEH_BODY_CD     VARCHAR(5)     NULL,         -- 4DR/2DR/CPE/SUV/TRK
    VEH_TYP_CD      CHAR(3)        NOT NULL DEFAULT 'PP',
    VIN_NO          VARCHAR(17)    NULL,
    LIC_PLTE_NO     VARCHAR(15)    NULL,
    LIC_ST_CD       CHAR(2)        NULL,
    GRS_VEH_WT      INT            NULL,         -- gross vehicle weight lbs
    USE_CD          VARCHAR(5)     NOT NULL DEFAULT 'PL',  -- PL/BUS/FM/CO
    GARAGING_ST_CD  CHAR(2)        NULL,
    ANN_MILEAGE     INT            NULL,
    SYMBOL_CD       VARCHAR(5)     NULL,
    RATING_TER_CD   VARCHAR(5)     NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_VEH_Policy FOREIGN KEY (POL_NO) REFERENCES legacy.PolicyMaster(POL_NO)
);

-- ── Driver ───────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Driver' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Driver (
    DRVR_ID         INT            NOT NULL CONSTRAINT PK_Driver PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    DRVR_NO         SMALLINT       NOT NULL DEFAULT 1,
    DRVR_STATUS_CD  CHAR(4)        NOT NULL DEFAULT 'PRM',  -- PRM/OCC/EXC/LIST
    INSD_ID         INT            NULL,
    LIC_NO          VARCHAR(20)    NULL,
    LIC_ST_CD       CHAR(2)        NULL,
    LIC_DT          DATE           NULL,
    LIC_TYP_CD      VARCHAR(5)     NULL,         -- REG/CDL/PROV/INT
    DOB_DT          DATE           NULL,
    GNDR_CD         CHAR(1)        NULL,
    MARITAL_STS_CD  CHAR(1)        NULL,
    OCC_CD          VARCHAR(10)    NULL,
    ACCIDENTS_CNT   SMALLINT       NOT NULL DEFAULT 0,
    VIOLATIONS_CNT  SMALLINT       NOT NULL DEFAULT 0,
    SR22_FL         CHAR(1)        NOT NULL DEFAULT 'N',
    PTS_TOTAL       SMALLINT       NOT NULL DEFAULT 0,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_DRVR_Policy   FOREIGN KEY (POL_NO)   REFERENCES legacy.PolicyMaster(POL_NO),
    CONSTRAINT FK_DRVR_Insured  FOREIGN KEY (INSD_ID)  REFERENCES legacy.NamedInsured(INSD_ID)
);

-- ── Coverage ─────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Coverage' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Coverage (
    CVG_ID          INT            NOT NULL CONSTRAINT PK_Coverage PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    VEH_ID          INT            NULL,         -- NULL = policy-level coverage
    LOC_ID          INT            NULL,         -- NULL = non-property coverage
    CVG_CD          VARCHAR(10)    NOT NULL,     -- BI/PD/COMP/COLL/MED/UM/UIM
    CVG_TYP_CD      VARCHAR(10)    NOT NULL,
    EFF_DT          DATE           NOT NULL,
    EXP_DT          DATE           NOT NULL,
    CVG_STS_CD      CHAR(1)        NOT NULL DEFAULT 'A',
    FORM_NO         VARCHAR(20)    NULL,
    ENDORS_NO       VARCHAR(20)    NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_CVG_Policy   FOREIGN KEY (POL_NO)  REFERENCES legacy.PolicyMaster(POL_NO),
    CONSTRAINT FK_CVG_Vehicle  FOREIGN KEY (VEH_ID)  REFERENCES legacy.Vehicle(VEH_ID),
    CONSTRAINT FK_CVG_Location FOREIGN KEY (LOC_ID)  REFERENCES legacy.Location(LOC_ID)
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='CoverageLimit' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.CoverageLimit (
    LMT_ID          INT            NOT NULL CONSTRAINT PK_CoverageLimit PRIMARY KEY,
    CVG_ID          INT            NOT NULL,
    LMT_TYP_CD      VARCHAR(5)     NOT NULL,     -- POCC/AGG/PERP/PROP
    PER_OCCUR_LMT   DECIMAL(12,2)  NULL,
    AGG_LMT         DECIMAL(12,2)  NULL,
    PER_PERSON_LMT  DECIMAL(12,2)  NULL,
    PROP_LMT        DECIMAL(12,2)  NULL,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_LMT_Coverage FOREIGN KEY (CVG_ID) REFERENCES legacy.Coverage(CVG_ID)
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='CoverageDeductible' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.CoverageDeductible (
    DED_ID          INT            NOT NULL CONSTRAINT PK_CoverageDeductible PRIMARY KEY,
    CVG_ID          INT            NOT NULL,
    DED_TYP_CD      VARCHAR(5)     NOT NULL,     -- FLAT/PCT/WAIV
    DED_AMT         DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    DED_PCT         DECIMAL(5,2)   NULL,
    DED_BASIS_CD    VARCHAR(5)     NULL,         -- LOSS/VALUE
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_DED_Coverage FOREIGN KEY (CVG_ID) REFERENCES legacy.Coverage(CVG_ID)
);

-- ── Premium ──────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Premium' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.Premium (
    PREM_ID         INT            NOT NULL CONSTRAINT PK_Premium PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    CVG_ID          INT            NULL,
    PREM_TYP_CD     VARCHAR(5)     NOT NULL DEFAULT 'BASE', -- BASE/ENDOS/AUDIT/RETN
    EFF_DT          DATE           NOT NULL,
    EXP_DT          DATE           NOT NULL,
    WRTTN_PREM_AMT  DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    ERND_PREM_AMT   DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    BILL_PREM_AMT   DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
    TAX_AMT         DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    FEE_AMT         DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    SURCH_AMT       DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    DISC_AMT        DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    ENTRY_DT        DATETIME       NOT NULL DEFAULT GETDATE(),
    LAST_UPD_DT     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_PREM_Policy   FOREIGN KEY (POL_NO)  REFERENCES legacy.PolicyMaster(POL_NO),
    CONSTRAINT FK_PREM_Coverage FOREIGN KEY (CVG_ID)  REFERENCES legacy.Coverage(CVG_ID)
);

-- ── Policy Notes ─────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='PolicyNotes' AND schema_id=SCHEMA_ID('legacy'))
CREATE TABLE legacy.PolicyNotes (
    NOTE_ID         INT            NOT NULL CONSTRAINT PK_PolicyNotes PRIMARY KEY,
    POL_NO          VARCHAR(20)    NOT NULL,
    NOTE_TYP_CD     VARCHAR(5)     NOT NULL DEFAULT 'GEN',  -- GEN/UNDW/BILL/CLMS
    NOTE_TXT        VARCHAR(2000)  NOT NULL,
    NOTE_DT         DATETIME       NOT NULL DEFAULT GETDATE(),
    USER_ID         VARCHAR(20)    NOT NULL DEFAULT 'SYSTEM',
    PRVT_FL         CHAR(1)        NOT NULL DEFAULT 'N',
    CONSTRAINT FK_NOTE_Policy FOREIGN KEY (POL_NO) REFERENCES legacy.PolicyMaster(POL_NO)
);

PRINT 'All legacy tables created successfully.';
GO
