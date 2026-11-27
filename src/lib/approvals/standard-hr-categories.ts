/**
 * The HR request types the HR Approval form is meant to offer in its Category dropdown, in the order they are added. Pure data, shared by the
 * seed (scripts/seed-approvals.ts) and checked against scripts/add-standard-hr-categories.sql by a unit test, so the two cannot drift apart.
 *
 * The dropdown itself has no list of its own: it shows the ACTIVE rows of apr_hr_categories, which an administrator manages in Approval System >
 * Admin > HR Request Types. So a database that was reset (scripts/reset-keep-aistudio-and-applications.sql empties that table), or one that was
 * never seeded, offers only what someone has added by hand, which is how the form can end up showing a single category. Running
 * scripts/add-standard-hr-categories.sql puts these back without touching anything an administrator has changed.
 */

/** Requests for a document or a notice from HR. */
export const HR_DOCUMENT_CATEGORIES = [
  "Certificate",
  "Letter",
  "Experience Letter",
  "NOC Letter",
  "Letter Draft (Offer Letter)",
  "Circular",
  "Celebration",
  "Expenses",
] as const;

/** HR expense approvals: the categories of the Zoho Creator HR form this system replaced (scripts/add-hr-categories.sql added these). */
export const HR_EXPENSE_CATEGORIES = [
  "Recruitment Expenses",
  "Employee Onboarding Expenses",
  "Training & Development Expenses",
  "Employee Welfare Expenses",
  "Staff Refreshments",
  "Employee Engagement Expenses",
  "Team Building Activities",
  "Employee Travel Expenses",
  "Employee Accommodation Expenses",
  "Relocation Expenses",
  "Medical Expenses",
  "Health Check-up Expenses",
  "Employee Insurance Expenses",
  "Uniform & Dress Code Expenses",
  "Employee ID Card Expenses",
  "Rewards & Recognition Expenses",
  "Festival Celebration Expenses",
  "Employee Gifts",
  "Staff Event Expenses",
  "HR Consultancy Expenses",
  "Background Verification Expenses",
  "Job Portal & Recruitment Advertising Expenses",
  "Employee Reimbursement",
  "Staff Transportation Expenses",
  "HR Software & Subscription Expenses",
  "Miscellaneous HR Expenses",
] as const;

export const STANDARD_HR_CATEGORIES: readonly string[] = [...HR_DOCUMENT_CATEGORIES, ...HR_EXPENSE_CATEGORIES];
