-- Adds the Zoho Creator approval request categories to the Approval System's expense categories (apr_categories).
-- Paste into the Neon console (SQL Editor) and run. Safe to run more than once: a name that already exists (any capitalisation) is left as it is.
-- New categories go after the existing ones, in this order. The forms show them within 5 minutes (the category list is cached).

begin;

with wanted(name, n) as (
  values
    ('Maintenance', 1), ('Travel', 2), ('Accommodation', 3), ('Transportation', 4), ('Purchase / Procurement', 5),
    ('Office Supplies', 6), ('IT Support', 7), ('Equipment Repair', 8), ('Administrative Expenses', 9), ('Reimbursement', 10),
    ('Advance Payment', 11), ('Vendor Payment', 12), ('Event / Meeting Expenses', 13), ('Training & Development', 14), ('Marketing & Advertising', 15),
    ('Printing & Stationery', 16), ('Housekeeping', 17), ('Facility Management', 18), ('Utilities', 19), ('Miscellaneous Expenses', 20)
), start as (select coalesce(max(sort), 0) as s from apr_categories)
insert into apr_categories (name, active, sort)
select w.name, true, start.s + w.n * 10 from wanted w, start
on conflict (lower(name)) do nothing;

commit;

-- Check: all 20, and whether each one is active (an existing inactive one with the same name is not switched on by this script).
select name, active, sort from apr_categories
where lower(name) in (
  'maintenance', 'travel', 'accommodation', 'transportation', 'purchase / procurement', 'office supplies', 'it support', 'equipment repair',
  'administrative expenses', 'reimbursement', 'advance payment', 'vendor payment', 'event / meeting expenses', 'training & development',
  'marketing & advertising', 'printing & stationery', 'housekeeping', 'facility management', 'utilities', 'miscellaneous expenses'
)
order by sort;
