-- Puts the standard HR request types back into the HR Approval form's Category dropdown (apr_hr_categories). Paste the whole file into the SQL
-- Editor of the production database (Supabase, or Neon if DB_DRIVER is not "pg") and run it. Data only: no table or column changes.
--
-- WHY THE DROPDOWN SHOWED ONLY ONE CATEGORY
-- The form has no list of its own: it shows the ACTIVE rows of apr_hr_categories, which administrators manage in Approval System > Admin >
-- HR Request Types. Nothing in a deploy creates them, and scripts/reset-keep-aistudio-and-applications.sql empties that table, so a database
-- that was reset (or never seeded) offers only what someone added or switched on by hand afterwards.
--
-- WHAT THIS ADDS (34): Certificate, Letter, Experience Letter, NOC Letter, Letter Draft (Offer Letter), Circular, Celebration, Expenses, and the 26
-- HR expense categories of the old Zoho Creator form (the ones scripts/add-hr-categories.sql added: Recruitment Expenses ... Miscellaneous HR
-- Expenses). The same list is in src/lib/approvals/standard-hr-categories.ts (a unit test keeps the two the same).
--
-- WHAT IT NEVER DOES
--   - it does not change a category that is already there (a name that exists in any capitalisation, or with stray spaces, is skipped), so nothing an administrator
--     renamed, re-ordered or switched off is touched;
--   - it does not switch a category ON. One that exists but is inactive stays inactive (the report at the end lists them, with the line to switch
--     them on if that is what you want).
-- New ones go after the existing ones in this order. Safe to run more than once. The HR form shows them straight away; the Approval System's
-- other lists that cache the categories refresh within 5 minutes.

begin;

with wanted(name, n) as (
  values
    ('Certificate', 1), ('Letter', 2), ('Experience Letter', 3), ('NOC Letter', 4), ('Letter Draft (Offer Letter)', 5), ('Circular', 6),
    ('Celebration', 7), ('Expenses', 8),
    ('Recruitment Expenses', 9), ('Employee Onboarding Expenses', 10), ('Training & Development Expenses', 11), ('Employee Welfare Expenses', 12),
    ('Staff Refreshments', 13), ('Employee Engagement Expenses', 14), ('Team Building Activities', 15), ('Employee Travel Expenses', 16),
    ('Employee Accommodation Expenses', 17), ('Relocation Expenses', 18), ('Medical Expenses', 19), ('Health Check-up Expenses', 20),
    ('Employee Insurance Expenses', 21), ('Uniform & Dress Code Expenses', 22), ('Employee ID Card Expenses', 23), ('Rewards & Recognition Expenses', 24),
    ('Festival Celebration Expenses', 25), ('Employee Gifts', 26), ('Staff Event Expenses', 27), ('HR Consultancy Expenses', 28),
    ('Background Verification Expenses', 29), ('Job Portal & Recruitment Advertising Expenses', 30), ('Employee Reimbursement', 31),
    ('Staff Transportation Expenses', 32), ('HR Software & Subscription Expenses', 33), ('Miscellaneous HR Expenses', 34)
), start as (select coalesce(max(sort), 0) as s from apr_hr_categories)
insert into apr_hr_categories (name, active, sort)
select w.name, true, start.s + w.n * 10 from wanted w, start
-- already there, in any capitals and with or without stray spaces at the ends (the table's own unique index only ignores capitals)
where not exists (select 1 from apr_hr_categories x where lower(btrim(x.name)) = lower(w.name))
on conflict (lower(name)) do nothing;

commit;

-- Report 1: how many of the 34 are now offered on the form (active), and how many exist but are switched off.
select count(*) filter (where active) as offered_on_the_form, count(*) filter (where not active) as exist_but_inactive, count(*) as of_the_standard_34
from apr_hr_categories
where lower(btrim(name)) in (
  'certificate', 'letter', 'experience letter', 'noc letter', 'letter draft (offer letter)', 'circular', 'celebration', 'expenses',
  'recruitment expenses', 'employee onboarding expenses', 'training & development expenses', 'employee welfare expenses', 'staff refreshments',
  'employee engagement expenses', 'team building activities', 'employee travel expenses', 'employee accommodation expenses', 'relocation expenses',
  'medical expenses', 'health check-up expenses', 'employee insurance expenses', 'uniform & dress code expenses', 'employee id card expenses',
  'rewards & recognition expenses', 'festival celebration expenses', 'employee gifts', 'staff event expenses', 'hr consultancy expenses',
  'background verification expenses', 'job portal & recruitment advertising expenses', 'employee reimbursement', 'staff transportation expenses',
  'hr software & subscription expenses', 'miscellaneous hr expenses'
);

-- Report 2: every category the form is offering right now, in the order it shows them.
-- select name, sort from apr_hr_categories where active order by sort, name;

-- Report 3: the ones that exist but are switched off (a deliberate choice by an administrator, or left over from a historical import, which adds
-- the categories it finds as inactive).
-- select name, sort from apr_hr_categories where not active order by sort, name;

-- To switch particular ones on (name them in lower case), or do it in Approval System > Admin > HR Request Types:
-- update apr_hr_categories set active = true where lower(name) in ('letter', 'noc letter');
