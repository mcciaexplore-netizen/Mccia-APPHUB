import { NextResponse } from "next/server";
import { idParam, ok, route } from "@/lib/approvals/guard";
import { batchReport } from "@/lib/approvals/historical/import";

export const dynamic = "force-dynamic";

/** One import's per-record report. Approvals admins only. */
export const GET = route<{ id: string }>({ roles: ["approvals_admin"] }, async ({ params }) => {
  const report = await batchReport(idParam(params.id));
  return report ? ok({ report }) : NextResponse.json({ error: "Not found." }, { status: 404 });
});
