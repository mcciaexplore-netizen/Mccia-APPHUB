import { NextResponse } from "next/server";
import { HttpError, assertAdmin } from "@/lib/ivr/dal";
import { listIvrAgents } from "@/lib/ivr/host-adapter";

const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// A small CSV that shows the shape the importer understands, using real agents from this installation; the last row names no agent, so the allocation rules decide.
export async function GET() {
  try {
    await assertAdmin();
    const agents = (await listIvrAgents()).slice(0, 3);
    const pick = (i: number) => agents[i % Math.max(agents.length, 1)] ?? { name: "", email: "" };
    const rows = [
      ["Member Name", "Mobile", "Email", "Organisation", "Member Code", "Call Category", "List", "Assigned To", "Agent Email"],
      ["Sunil Kulkarni", "9876543210", "sunil@example.com", "Kulkarni Tools", "M-1042", "Membership", "Renewal 2026", pick(0).name, pick(0).email],
      ["Priya Deshpande", "+91 98765 43211", "priya@example.com", "Deshpande Foods", "M-0877", "Proforma invoice", "Renewal 2026", pick(1).name, pick(1).email],
      ["Rakesh Joshi", "9876543212", "", "Joshi Traders", "M-1310", "Hall booking", "Hall bookings Nov", "", ""],
    ];
    const csv = rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="member-import-sample.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
