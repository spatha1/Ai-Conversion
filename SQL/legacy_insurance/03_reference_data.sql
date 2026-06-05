-- ============================================================
-- LegacyInsurance Reference Data Seed
-- ============================================================

USE LegacyInsurance;
GO

-- ── Policy Status ────────────────────────────────────────────
DELETE FROM legacy.RefPolicyStatus;
INSERT INTO legacy.RefPolicyStatus (STS_CD, STS_DESC) VALUES
('A', 'Active'),
('C', 'Cancelled'),
('P', 'Pending'),
('E', 'Expired'),
('R', 'Reinstated');

-- ── Line of Business ─────────────────────────────────────────
DELETE FROM legacy.RefLOB;
INSERT INTO legacy.RefLOB (LOB_CD, LOB_DESC) VALUES
('AUTO',      'Private Passenger Auto'),
('HOME',      'Homeowners'),
('GL',        'General Liability'),
('WC',        'Workers Compensation'),
('COMM_AUTO', 'Commercial Auto');

-- ── Coverage Types ────────────────────────────────────────────
DELETE FROM legacy.RefCoverageType;
INSERT INTO legacy.RefCoverageType (CVG_TYP_CD, CVG_TYP_DESC, MANDATORY_FL) VALUES
('BI',   'Bodily Injury Liability',           'Y'),
('PD',   'Property Damage Liability',         'Y'),
('COMP', 'Comprehensive (Other Than Collision)','N'),
('COLL', 'Collision',                         'N'),
('MED',  'Medical Payments',                  'N'),
('UM',   'Uninsured Motorist',                'Y'),
('UIM',  'Underinsured Motorist',             'N'),
('PIP',  'Personal Injury Protection',        'N'),
('TURO', 'Towing and Road Service',           'N'),
('RENT', 'Rental Reimbursement',              'N'),
('FIRE', 'Fire',                              'N'),
('THFT', 'Theft',                             'N'),
('WIND', 'Windstorm/Hail',                   'N'),
('LIAB', 'General Liability',                 'Y'),
('WC',   'Workers Compensation',              'Y');

-- ── States (all 50 + DC) ─────────────────────────────────────
DELETE FROM legacy.RefState;
INSERT INTO legacy.RefState (ST_CD, ST_NM, REGION_CD) VALUES
('AL','Alabama','SE'),      ('AK','Alaska','WE'),       ('AZ','Arizona','SW'),
('AR','Arkansas','SC'),     ('CA','California','WE'),    ('CO','Colorado','MW'),
('CT','Connecticut','NE'),  ('DE','Delaware','SO'),      ('FL','Florida','SE'),
('GA','Georgia','SE'),      ('HI','Hawaii','WE'),        ('ID','Idaho','WE'),
('IL','Illinois','MW'),     ('IN','Indiana','MW'),       ('IA','Iowa','MW'),
('KS','Kansas','SC'),       ('KY','Kentucky','SE'),      ('LA','Louisiana','SC'),
('ME','Maine','NE'),        ('MD','Maryland','SO'),      ('MA','Massachusetts','NE'),
('MI','Michigan','MW'),     ('MN','Minnesota','MW'),     ('MS','Mississippi','SE'),
('MO','Missouri','MW'),     ('MT','Montana','WE'),       ('NE','Nebraska','MW'),
('NV','Nevada','WE'),       ('NH','New Hampshire','NE'), ('NJ','New Jersey','NE'),
('NM','New Mexico','SW'),   ('NY','New York','NE'),      ('NC','North Carolina','SE'),
('ND','North Dakota','MW'), ('OH','Ohio','MW'),          ('OK','Oklahoma','SC'),
('OR','Oregon','WE'),       ('PA','Pennsylvania','NE'),  ('RI','Rhode Island','NE'),
('SC','South Carolina','SE'),('SD','South Dakota','MW'), ('TN','Tennessee','SE'),
('TX','Texas','SC'),        ('UT','Utah','WE'),          ('VT','Vermont','NE'),
('VA','Virginia','SO'),     ('WA','Washington','WE'),    ('WV','West Virginia','SO'),
('WI','Wisconsin','MW'),    ('WY','Wyoming','WE'),       ('DC','District of Columbia','SO');

-- ── Vehicle Types ─────────────────────────────────────────────
DELETE FROM legacy.RefVehicleType;
INSERT INTO legacy.RefVehicleType (VEH_TYP_CD, VEH_TYP_DESC, COMM_FL) VALUES
('PP',  'Private Passenger',    'N'),
('SUV', 'Sport Utility Vehicle','N'),
('TRK', 'Pickup Truck',         'N'),
('VAN', 'Minivan',              'N'),
('MC',  'Motorcycle',           'N'),
('RV',  'Recreational Vehicle', 'N'),
('CTK', 'Commercial Truck',     'Y'),
('BUS', 'Bus',                  'Y'),
('TRL', 'Trailer',              'Y');

-- ── Driver Status ─────────────────────────────────────────────
DELETE FROM legacy.RefDriverStatus;
INSERT INTO legacy.RefDriverStatus (DRVR_STS_CD, DRVR_STS_DESC) VALUES
('PRM',  'Primary Driver'),
('OCC',  'Occasional Driver'),
('EXC',  'Excluded Driver'),
('LIST', 'Listed Driver');

PRINT 'Reference data seeded successfully.';
GO
