import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { importBatches } from "@/db/ivr-schema";
import { hubUsers as users } from "@/lib/ivr/host-adapter";
import { ImportWizard } from "@/components/ivr/import/import-wizard";
import { Empty, PageHeader } from "@/components/ivr/ui";
import { requireAdmin } from "@/lib/ivr/dal";
import { formatIst } from "@/lib/ivr/time";

export const metadata = { title: "Import members" };

export default async function ImportPage() {
  await requireAdmin();
  const batches = await db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      uploader: users.name,
      totalRows: importBatches.totalRows,
      matched: importBatches.matched,
      ambiguous: importBatches.ambiguous,
      unmatched: importBatches.unmatched,
      duplicates: importBatches.duplicates,
      status: importBatches.status,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .leftJoin(users, eq(importBatches.uploadedBy, users.id))
    .orderBy(desc(importBatches.createdAt))
    .limit(8);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Import members"
        subtitle="Upload your calling list as Excel or CSV. Each row is allocated to the right agent automatically and lands in their call queue. You confirm before anything is saved."
      />
      <ImportWizard />

      <section aria-labelledby="recent-imports" className="grid gap-2">
        <h2 id="recent-imports" className="text-lg font-bold">
          Recent imports
        </h2>
        <div className="ivr-card overflow-x-auto">
          {batches.length ? (
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="ivr-th">File</th>
                  <th className="ivr-th">Imported by</th>
                  <th className="ivr-th">When</th>
                  <th className="ivr-th text-right">Rows</th>
                  <th className="ivr-th text-right">Allocated</th>
                  <th className="ivr-th text-right">Needed a choice</th>
                  <th className="ivr-th text-right">Unmatched</th>
                  <th className="ivr-th text-right">Duplicates</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="ivr-td font-medium">
                      {b.fileName}
                      {b.status !== "saved" && <span className="ivr-pill ml-2 bg-brand-purple/15 text-brand-purple">{b.status}</span>}
                    </td>
                    <td className="ivr-td text-muted">{b.uploader ?? "–"}</td>
                    <td className="ivr-td text-muted">{formatIst(b.createdAt, { year: "numeric" })}</td>
                    <td className="ivr-td tabular-nums text-right">{b.totalRows.toLocaleString()}</td>
                    <td className="ivr-td tabular-nums text-right">{b.matched.toLocaleString()}</td>
                    <td className="ivr-td tabular-nums text-right">{b.ambiguous.toLocaleString()}</td>
                    <td className="ivr-td tabular-nums text-right">{b.unmatched.toLocaleString()}</td>
                    <td className="ivr-td tabular-nums text-right">{b.duplicates.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No imports yet">The first file you save will be listed here with how many rows matched.</Empty>
          )}
        </div>
      </section>
    </div>
  );
}
