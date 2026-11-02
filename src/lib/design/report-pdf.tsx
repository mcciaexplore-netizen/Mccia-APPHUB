import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Report } from "./reports";

/** The reports page as a PDF: the totals and each table behind the charts. */

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#003F8A" },
  sub: { marginTop: 4, color: "#475569" },
  h2: { marginTop: 18, marginBottom: 6, fontSize: 11, fontFamily: "Helvetica-Bold", color: "#003F8A" },
  totals: { flexDirection: "row", marginTop: 14, gap: 8 },
  tile: { flex: 1, border: "1pt solid #e2e8f0", borderRadius: 6, padding: 8 },
  big: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#003F8A" },
  label: { marginTop: 2, color: "#64748b", fontSize: 8 },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #e2e8f0", paddingVertical: 3 },
  head: { flexDirection: "row", borderBottom: "1pt solid #94a3b8", paddingBottom: 3, fontFamily: "Helvetica-Bold" },
  cell: { flex: 1 },
  wide: { flex: 2 },
});

function Table({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <Text style={{ color: "#64748b" }}>Nothing in this period.</Text>;
  return (
    <View>
      <View style={s.head}>{cols.map((c, i) => <Text key={c} style={i === 0 ? s.wide : s.cell}>{c}</Text>)}</View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>{r.map((v, j) => <Text key={j} style={j === 0 ? s.wide : s.cell}>{String(v)}</Text>)}</View>
      ))}
    </View>
  );
}

export async function renderReportPdf(r: Report, by: string): Promise<Buffer> {
  const rate = r.totals.delivered ? `${Math.round((r.totals.onTime / r.totals.delivered) * 100)}%` : "–";
  const doc = (
    <Document title={`DesignDesk report ${r.from} to ${r.to}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>DesignDesk report</Text>
        <Text style={s.sub}>{r.from} to {r.to} · made by {by} on {new Date().toISOString().slice(0, 10)}</Text>
        <View style={s.totals}>
          {[["Requests", r.totals.created], ["Delivered", r.totals.delivered], ["On time", rate], ["Revisions", r.totals.revisions], ["Hours logged", r.totals.hours]].map(([l, v]) => (
            <View key={String(l)} style={s.tile}><Text style={s.big}>{String(v)}</Text><Text style={s.label}>{String(l)}</Text></View>
          ))}
        </View>
        <Text style={s.h2}>Deadlines met, by week</Text>
        <Table cols={["Week of", "Delivered", "On time"]} rows={r.sla.map((w) => [w.week, w.delivered, w.rate == null ? "–" : `${w.rate}%`])} />
        <Text style={s.h2}>Average turnaround by design</Text>
        <Table cols={["Design", "Delivered", "Hours"]} rows={r.turnaround.map((t) => [t.design, t.count, t.hours])} />
        <Text style={s.h2}>Revisions by department</Text>
        <Table cols={["Department", "Requests", "Revisions"]} rows={r.revisionsByDept.map((d) => [d.department, d.requests, d.revisions])} />
        <Text style={s.h2}>Hours by designer</Text>
        <Table cols={["Designer", "Hours"]} rows={r.hoursByDesigner.map((h) => [h.name, h.hours])} />
        <Text style={s.h2}>Requests by status, by week made</Text>
        <Table cols={["Week of", ...r.statusKeys]} rows={r.statusOverTime.map((w) => [w.week, ...r.statusKeys.map((k) => w[k] as number)])} />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
