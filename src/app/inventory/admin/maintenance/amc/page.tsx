import Link from "next/link";
import { Building2 } from "lucide-react";
import { amcBranchSummaries } from "@/lib/inventory/amc";
import { fyLabel, fyStartOf } from "@/lib/inventory/amc-shared";
import { formatRupees } from "@/lib/inventory/format";
import { requirePage } from "@/lib/inventory/guard";
import { AMC_PATH } from "@/lib/inventory/inventory.manifest";

export const metadata = { title: "AMC · Maintenance · Inventory · MCCIA App Hub" };

/**
 * Annual Maintenance Contracts, step one: a card for each branch with how many contracts it has and what they cost in the current financial
 * year; a click opens that branch's contracts. Inventory admins only: anyone else gets "not found".
 */
export default async function AmcBranchesPage() {
  await requirePage("inventory_admin");
  const fy = fyStartOf();
  const branches = await amcBranchSummaries(fy);
  const contracts = branches.reduce((n, b) => n + b.count, 0);
  return (
    <div className="page-enter space-y-5">
      <div>
        <h1 className="text-2xl">Annual Maintenance Contracts</h1>
        <p className="text-sm text-muted">
          Choose a branch to see its contracts. {branches.length} {branches.length === 1 ? "branch" : "branches"}, {contracts} {contracts === 1 ? "contract" : "contracts"} in all.
        </p>
      </div>
      {branches.length === 0 ? (
        <p className="rounded-[14px] border border-gray-200 bg-white px-5 py-8 text-center text-sm text-subtle">No branches yet. Add them in Administrator → Branches.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="amc-branches">
          {branches.map((b) => (
            <li key={b.id}>
              <Link
                href={`${AMC_PATH}/${b.id}`}
                className="flex h-full flex-col gap-1 rounded-[14px] border border-gray-200 bg-white p-4 transition-colors hover:border-[#2a6b7c] hover:bg-[#f0f7f9] focus-visible:border-[#2a6b7c]"
              >
                <span className="flex items-center gap-2 font-bold text-ink">
                  <Building2 size={16} aria-hidden className="shrink-0 text-primary" />
                  <span className="min-w-0 break-words">{b.name}</span>
                </span>
                {!b.active && <span className="badge badge-neutral self-start">Inactive</span>}
                <span className="mt-1 text-2xl font-bold text-ink">
                  {b.count} <span className="text-sm font-semibold text-muted">AMC</span>
                </span>
                <span className="text-xs text-muted">FY {fyLabel(fy)}</span>
                <span className="font-semibold tabular-nums text-ink">{formatRupees(b.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
