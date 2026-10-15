/**
 * The three states an account shows in the directory. A person who has never chosen a password (created by an invitation) is
 * "pending" until they do. The main admin signs in with a password from the environment, so having no stored one is normal for them.
 */
export type AccountStatus = "active" | "inactive" | "pending";

export const accountStatus = (u: { isActive: boolean; hasPassword: boolean; mainAdmin: boolean }): AccountStatus =>
  !u.isActive ? "inactive" : u.hasPassword || u.mainAdmin ? "active" : "pending";

export const STATUS_LABEL: Record<AccountStatus, string> = { active: "Active", inactive: "Inactive", pending: "Pending invitation" };
export const STATUS_BADGE: Record<AccountStatus, string> = { active: "badge badge-green", inactive: "badge badge-red", pending: "badge badge-purple" };
