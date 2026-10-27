/**
 * The pages that count as Administrator for the password re-check and the lock: Administrator itself and the Approval System's admin
 * pages (/approvals/admin/*). Opening one needs Administrator unlocked; moving between them keeps it unlocked; leaving them locks it.
 * Pure, so the proxy (src/proxy.ts), the page frame and the unlock action all use the same rule.
 */
export const isAdminPath = (path: string) => {
  const p = path.split(/[?#]/)[0];
  return p === "/administrator" || p.startsWith("/administrator/") || p === "/approvals/admin" || p.startsWith("/approvals/admin/");
};
