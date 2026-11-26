-- Sets up the AMC section's branches and the SB Road branch's eleven Annual Maintenance Contracts (FY 2025-26 and 2026-27). Paste the whole
-- file into the SQL Editor of the production database, AFTER scripts/apply-0053-inventory-amc.sql has run.
--
-- Step 1: the five branches the AMC section is run for (Ahilyanagar, Bhosri, Hadapsar, SB Road, Tilak Road) are created if they are not
--         there (a name already there, in any capitals or with stray spaces, counts as there). These are the hub's branches, the same ones
--         as in Administrator > Branches.
--         It STOPS, adding nothing, if a branch is missing but another one has a similar name (for example "MCCIA SB Road" while there is no
--         "SB Road"): rename that branch in Administrator > Branches first, so that no branch is made twice. (A different spelling, such as
--         "Bhosari" for "Bhosri", cannot be told apart from a different branch: look at the branch list this prints at the end.)
-- Step 2: the eleven SB Road contracts go into the branch called "SB Road".
--
-- Safe to run more than once: nothing is created that is already there, and a contract already there for the same branch, year, equipment
-- and vendor is skipped. Amounts are in paise (₹32,500 = 3250000), as everywhere in Inventory.
--
-- The totals it should give (checked by the last lines): FY 2025-26 ₹4,35,499 and FY 2026-27 ₹3,91,237.
--
-- To undo step 2: DELETE FROM inventory_amc WHERE fy_start_year = 2025 AND branch_id = (SELECT id FROM branches WHERE lower(btrim(name)) = 'sb road');
-- (A branch that was created is removed in Administrator > Branches; it cannot be removed while it has contracts.)

DO $$
DECLARE
  wanted constant text[] := ARRAY['Ahilyanagar', 'Bhosri', 'Hadapsar', 'SB Road', 'Tilak Road'];
  w text;
  made int := 0;
  sb_id uuid;
  n int;
  added int;
BEGIN
  -- Step 1: the branches. Check them all first, so a refusal leaves nothing half done.
  FOREACH w IN ARRAY wanted LOOP
    IF NOT EXISTS (SELECT 1 FROM branches WHERE lower(btrim(name)) = lower(w)) THEN
      SELECT count(*) INTO n FROM branches WHERE name ILIKE '%' || w || '%';
      IF n > 0 THEN
        RAISE EXCEPTION 'There is no branch called "%", but % other branch(es) have it in their name (%). Rename that branch in Administrator > Branches to exactly "%" and run this again, so it is not made twice.',
          w, n, (SELECT string_agg(name, ', ' ORDER BY name) FROM branches WHERE name ILIKE '%' || w || '%'), w;
      END IF;
    END IF;
  END LOOP;
  FOREACH w IN ARRAY wanted LOOP
    INSERT INTO branches (name) SELECT w WHERE NOT EXISTS (SELECT 1 FROM branches WHERE lower(btrim(name)) = lower(w));
    IF FOUND THEN made := made + 1; END IF;
  END LOOP;
  RAISE NOTICE 'Branches: % created. Now: %', made, (SELECT string_agg(name, ', ' ORDER BY name) FROM branches);

  -- Step 2: SB Road's contracts.
  SELECT count(*) INTO n FROM branches WHERE lower(btrim(name)) = 'sb road';
  IF n <> 1 THEN
    RAISE EXCEPTION '% branches are called "SB Road" (ignoring capitals): there must be exactly one. Fix them in Administrator > Branches.', n;
  END IF;
  SELECT id INTO sb_id FROM branches WHERE lower(btrim(name)) = 'sb road';

  INSERT INTO inventory_amc (branch_id, equipment_service, vendor_name, amc_type, fy_start_year, amount_current_fy, amount_next_fy, created_by, created_at)
  SELECT sb_id, v.equipment, v.vendor, v.kind::inventory_amc_type, 2025, v.cur, v.nxt,
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
    WHERE x.branch_id = sb_id AND x.fy_start_year = 2025 AND lower(x.equipment_service) = lower(v.equipment) AND lower(x.vendor_name) = lower(v.vendor)
  );
  GET DIAGNOSTICS added = ROW_COUNT;
  RAISE NOTICE 'SB Road AMC: % of 11 contracts added (the rest were already there).', added;
END
$$;

-- Afterwards the first query should list the five branches, and the second return 11, 43549900 and 39123700 (₹4,35,499 and ₹3,91,237) on a first run:
-- SELECT name FROM branches ORDER BY name;
-- SELECT count(*) AS contracts, sum(amount_current_fy) AS paise_2025_26, sum(amount_next_fy) AS paise_2026_27
-- FROM inventory_amc WHERE fy_start_year = 2025 AND branch_id = (SELECT id FROM branches WHERE lower(btrim(name)) = 'sb road');
