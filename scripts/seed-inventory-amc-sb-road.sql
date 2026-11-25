-- Puts the SB Road branch's eleven Annual Maintenance Contracts (FY 2025-26 and 2026-27) into Inventory > Maintenance > AMC. Paste the whole
-- file into the SQL Editor of the production database, AFTER scripts/apply-0053-inventory-amc.sql has run.
--
-- Safe to run more than once: a contract already there for the same branch, year, equipment and vendor is skipped, so nothing is doubled.
-- It stops with a message (and adds nothing) if no branch, or more than one, has "SB Road" in its name: put the branch's exact name on the
-- line marked below. Amounts are in paise (₹32,500 = 3250000), as everywhere in Inventory.
--
-- The totals it should give (checked by the last line): FY 2025-26 ₹4,35,499 and FY 2026-27 ₹3,91,237.
--
-- To undo it: DELETE FROM inventory_amc WHERE fy_start_year = 2025 AND branch_id = (SELECT id FROM branches WHERE name ILIKE '%SB Road%');

DO $$
DECLARE
  branch_name constant text := 'SB Road';   -- <- the branch's name, or part of it, as in Administrator > Branches
  b_id uuid;
  n int;
  added int;
BEGIN
  SELECT count(*) INTO n FROM branches WHERE name ILIKE '%' || branch_name || '%';
  IF n = 0 THEN
    RAISE EXCEPTION 'No branch with "%" in its name was found. Add it in Administrator > Branches first, or change branch_name at the top of this script.', branch_name;
  ELSIF n > 1 THEN
    RAISE EXCEPTION '% branches have "%" in their name. Put the exact name in branch_name at the top of this script.', n, branch_name;
  END IF;
  SELECT id INTO b_id FROM branches WHERE name ILIKE '%' || branch_name || '%';

  INSERT INTO inventory_amc (branch_id, equipment_service, vendor_name, amc_type, fy_start_year, amount_current_fy, amount_next_fy, created_by, created_at)
  SELECT b_id, v.equipment, v.vendor, v.kind::inventory_amc_type, 2025, v.cur, v.nxt,
         COALESCE((SELECT id FROM users WHERE role = 'head_admin' ORDER BY created_at LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid),
         now() + v.n * interval '1 millisecond'   -- keeps the rows in the order below
  FROM (VALUES
    (1,  '30 KVA UPS',          'Powertechnics Info Solutions Pvt Ltd',   'non_comprehensive',   3250000::bigint,  3350000::bigint),
    (2,  'Fire Alarm System',   'GG Fire Engineering Technology Pvt Ltd', 'service',             2100000::bigint,  1699200::bigint),
    (3,  'Pest Control',        'Pestify',                                'service',             2320000::bigint,  2200000::bigint),
    (4,  'LG VRF AC system',    'K D Building Services LLP',              'non_comprehensive',   1912500::bigint,  1912500::bigint),
    (5,  'Projectors',          'Prompt Services',                        'non_comprehensive',   1260000::bigint,  1200000::bigint),
    (6,  'PA System',           'Samarth',                                'non_comprehensive',   1440000::bigint,  1440000::bigint),
    (7,  '3 KVA UPS',           'Ador Powertron Ltd',                     'non_comprehensive',    945000::bigint,   992000::bigint),
    (8,  'CCTV System',         'Samarth Enterprises',                    'non_comprehensive',    960000::bigint,   960000::bigint),
    (9,  '5 KVA UPS',           'Powertechnics Info Solutions Pvt Ltd',   'non_comprehensive',    850000::bigint,   950000::bigint),
    (10, 'EPABX',               'Parsn Technologies Pvt Ltd',             'comprehensive',       2450000::bigint,  2450000::bigint),
    (11, 'Blue Star AC',        'Technogreen Air Conditioning Pvt Ltd',   'cec',                26062400::bigint, 21970000::bigint)
  ) AS v(n, equipment, vendor, kind, cur, nxt)
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_amc x
    WHERE x.branch_id = b_id AND x.fy_start_year = 2025 AND lower(x.equipment_service) = lower(v.equipment) AND lower(x.vendor_name) = lower(v.vendor)
  );
  GET DIAGNOSTICS added = ROW_COUNT;
  RAISE NOTICE 'SB Road AMC: % of 11 contracts added (the rest were already there).', added;
END
$$;

-- Afterwards this should return 11, 43549900 and 39123700 (₹4,35,499 and ₹3,91,237) on a first run:
-- SELECT count(*) AS contracts, sum(amount_current_fy) AS paise_2025_26, sum(amount_next_fy) AS paise_2026_27
-- FROM inventory_amc WHERE fy_start_year = 2025 AND branch_id = (SELECT id FROM branches WHERE name ILIKE '%SB Road%');
