/**
 * The three states an account shows in the directory. A person who has never chosen a password (created by an invitation) is
 * "pending" until they do. The Support Admin's password comes from the environment, so having no stored one is normal for them.
 */
export type AccountStatus = "active" | "inactive" | "pending";

export const accountStatus = (u: { isActive: boolean; hasPassword: boolean; passwordInSettings: boolean }): AccountStatus =>
  !u.isActive ? "inactive" : u.hasPassword || u.passwordInSettings ? "active" : "pending";

export const STATUS_LABEL: Record<AccountStatus, string> = { active: "Active", inactive: "Inactive", pending: "Pending invitation" };
export const STATUS_BADGE: Record<AccountStatus, string> = { active: "badge badge-green", inactive: "badge badge-red", pending: "badge badge-purple" };
