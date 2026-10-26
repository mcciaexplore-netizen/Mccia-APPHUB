-- Adds the Zoho Creator HR expense approval categories to the Approval System's HR categories (apr_hr_categories).
-- Paste into the Neon console (SQL Editor) and run. Safe to run more than once: a name that already exists (any capitalisation) is left as it is.
-- New categories go after the existing ones, in this order. The HR form shows them within 5 minutes (the category list is cached).

begin;

with wanted(name, n) as (
  values
    ('Recruitment Expenses', 1), ('Employee Onboarding Expenses', 2), ('Training & Development Expenses', 3), ('Employee Welfare Expenses', 4),
    ('Staff Refreshments', 5), ('Employee Engagement Expenses', 6), ('Team Building Activities', 7), ('Employee Travel Expenses', 8),
    ('Employee Accommodation Expenses', 9), ('Relocation Expenses', 10), ('Medical Expenses', 11), ('Health Check-up Expenses', 12),
    ('Employee Insurance Expenses', 13), ('Uniform & Dress Code Expenses', 14), ('Employee ID Card Expenses', 15), ('Rewards & Recognition Expenses', 16),
    ('Festival Celebration Expenses', 17), ('Employee Gifts', 18), ('Staff Event Expenses', 19), ('HR Consultancy Expenses', 20),
    ('Background Verification Expenses', 21), ('Job Portal & Recruitment Advertising Expenses', 22), ('Employee Reimbursement', 23),
    ('Staff Transportation Expenses', 24), ('HR Software & Subscription Expenses', 25), ('Miscellaneous HR Expenses', 26)
), start as (select coalesce(max(sort), 0) as s from apr_hr_categories)
insert into apr_hr_categories (name, active, sort)
select w.name, true, start.s + w.n * 10 from wanted w, start
on conflict (lower(name)) do nothing;

commit;

-- Check: all 26, and whether each one is active (an existing inactive one with the same name is not switched on by this script).
select name, active, sort from apr_hr_categories
where lower(name) in (
  'recruitment expenses', 'employee onboarding expenses', 'training & development expenses', 'employee welfare expenses', 'staff refreshments',
  'employee engagement expenses', 'team building activities', 'employee travel expenses', 'employee accommodation expenses', 'relocation expenses',
  'medical expenses', 'health check-up expenses', 'employee insurance expenses', 'uniform & dress code expenses', 'employee id card expenses',
  'rewards & recognition expenses', 'festival celebration expenses', 'employee gifts', 'staff event expenses', 'hr consultancy expenses',
  'background verification expenses', 'job portal & recruitment advertising expenses', 'employee reimbursement', 'staff transportation expenses',
  'hr software & subscription expenses', 'miscellaneous hr expenses'
)
order by sort;
