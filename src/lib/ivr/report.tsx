import "server-only";
import { Document, G, Line, Page, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  agentStats,
  assignmentStats,
  callList,
  callsPerDay,
  categoryStats,
  membersByStage,
  numberStats,
  summary,
  type AgentStat,
  type AnalyticsParams,
  type AssignmentSummary,
  type CallListRow,
  type CategoryStat,
  type DayPoint,
  type NumberRow,
  type StageCount,
  type Summary,
} from "./analytics";
import { formatDuration } from "./time";
import { formatPhone } from "./phone";
import { STAGES } from "./stage";

export const REPORT_SECTIONS = ["summary", "agents", "charts", "categories", "numbers", "assignments", "calls"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const CALL_LIST_CAP = 2000;
export const NUMBER_LIST_CAP = 60;

export type ReportOptions = AnalyticsParams & {
  sections: ReportSection[];
  fromLabel: string;
  toLabel: string;
  scopeLabel: string;
  generatedBy: string;
};

export type ReportData = {
  options: ReportOptions;
  generatedAt: string;
  summary: Summary;
  perDay: DayPoint[];
  agents: AgentStat[];
  stages: StageCount[];
  assignments: AssignmentSummary;
  categories: CategoryStat[];
  numbers: { rows: NumberRow[]; truncated: boolean } | null;
  calls: { rows: CallListRow[]; truncated: boolean } | null;
};

export async function buildReport(options: ReportOptions): Promise<ReportData> {
  const has = (s: ReportSection) => options.sections.includes(s);
  const p: AnalyticsParams = { from: options.from, to: options.to, userIds: options.userIds };
  const [sum, perDay, agents, stages, assignments, categories, numbers, calls] = await Promise.all([
    summary(p),
    has("charts") ? callsPerDay(p) : Promise.resolve([]),
    has("agents") || has("charts") ? agentStats(p) : Promise.resolve([]),
    has("charts") ? membersByStage(options.userIds) : Promise.resolve([]),
    has("assignments") ? assignmentStats(p) : Promise.resolve({ rows: [], totalAssigned: 0, totalReassigned: 0 }),
    has("categories") ? categoryStats(p) : Promise.resolve([]),
    has("numbers") ? numberStats(p, { limit: NUMBER_LIST_CAP }) : Promise.resolve(null),
    has("calls") ? callList(p, CALL_LIST_CAP) : Promise.resolve(null),
  ]);
  return {
    options,
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
    summary: sum,
    perDay,
    agents,
    stages,
    assignments,
    categories,
    numbers,
    calls,
  };
}

// Light-theme hex values of the app tokens. PDFs cannot read CSS variables.
const C = {
  ink: "#0F172A",
  muted: "#475569",
  line: "#E2E8F0",
  band: "#F8FAFC",
  accent: "#2A6B7C",
  missed: "#EF4444",
  sched: "#2A6B7C",
  done: "#059669",
  incoming: "#8B5CF6",
  attempted: "#D97706",
  closed: "#475569",
};

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9, color: C.ink },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9.5, color: C.muted, marginTop: 3 },
  rule: { height: 1, backgroundColor: C.line, marginVertical: 10 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 14 },
  kpis: { flexDirection: "row", gap: 8 },
  kpi: { flexGrow: 1, flexBasis: 0, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 8 },
  kpiL: { fontSize: 8, color: C.muted },
  kpiV: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 2 },
  th: { flexDirection: "row", backgroundColor: C.band, paddingVertical: 4, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 3.5, paddingHorizontal: 4 },
  thT: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#64748B", textTransform: "uppercase" },
  note: { fontSize: 8, color: C.muted, marginTop: 4 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 22, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.muted },
  legend: { flexDirection: "row", gap: 12, marginBottom: 4, fontSize: 8, color: C.muted },
  sw: { width: 7, height: 7, marginRight: 4 },
});

type Col<T> = { label: string; w: number; align?: "right"; cell: (r: T) => string };

function Table<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <View>
      <View style={s.th}>
        {cols.map((c) => (
          <Text key={c.label} style={[s.thT, { flexGrow: c.w, flexBasis: 0, textAlign: c.align ?? "left" }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {cols.map((c) => (
            <Text key={c.label} style={{ flexGrow: c.w, flexBasis: 0, textAlign: c.align ?? "left" }}>
              {c.cell(r)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

type SvgTextProps = { x: number; y: number; fontSize?: number; fill?: string; textAnchor?: "start" | "middle" | "end"; children?: React.ReactNode };
// The published types for SVG <Text> omit fontSize, but the renderer reads it.
const SText = (({ fontSize, ...p }: SvgTextProps) => <Text {...(p as object as { x: number; y: number })} {...({ style: { fontSize }, fontSize } as object)} />) as (p: SvgTextProps) => React.ReactElement;

const W = 515; // A4 width minus page padding

function niceMax(n: number): number {
  if (n <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(n));
  const f = n / mag;
  return ([1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((step) => f <= step) ?? 10) * mag;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={[s.sw, { backgroundColor: color }]} />
      <Text>{label}</Text>
    </View>
  );
}

function DayChart({ data }: { data: DayPoint[] }) {
  const H = 130;
  const left = 26;
  const top = 6;
  const bottom = 16;
  const max = niceMax(Math.max(1, ...data.map((d) => d.answered + d.notAnswered)));
  const plotH = H - top - bottom;
  const slot = (W - left) / Math.max(1, data.length);
  const bw = Math.max(1.5, Math.min(18, slot - 2));
  const y = (v: number) => top + plotH * (1 - v / max);
  const ticks = [0, max / 2, max];
  const labelAt = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return (
    <View wrap={false}>
      <View style={s.legend}>
        <Swatch color={C.accent} label="Answered" />
        <Swatch color={C.missed} label="Not answered" />
      </View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((t) => (
          <Line key={t} x1={left} x2={W} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth={0.5} />
        ))}
        {ticks.map((t) => (
          <SText key={`l${t}`} x={left - 4} y={y(t) + 3} fontSize={7} fill={C.muted} textAnchor="end">
            {String(Math.round(t))}
          </SText>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          const hA = (plotH * d.answered) / max;
          const hM = (plotH * d.notAnswered) / max;
          return (
            <G key={d.day}>
              <Rect x={x} y={y(0) - hA} width={bw} height={hA} fill={C.accent} />
              <Rect x={x} y={y(0) - hA - hM - (hA && hM ? 1 : 0)} width={bw} height={hM} fill={C.missed} />
              {labelAt.has(i) && (
                <SText x={x + bw / 2} y={H - 4} fontSize={7} fill={C.muted} textAnchor="middle">
                  {shortDay(d.day)}
                </SText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

type Bar = { label: string; value: number; text: string; color: string };

function HBarChart({ bars, max }: { bars: Bar[]; max: number }) {
  const rowH = 20;
  const labelW = 110;
  const valueW = 46;
  const H = bars.length * rowH + 4;
  const plotW = W - labelW - valueW;
  return (
    <View wrap={false}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {bars.map((b, i) => {
          const yy = i * rowH + 2;
          return (
            <G key={b.label}>
              <SText x={labelW - 6} y={yy + 11} fontSize={8} fill={C.ink} textAnchor="end">
                {b.label.length > 22 ? `${b.label.slice(0, 21)}.` : b.label}
              </SText>
              <Rect x={labelW} y={yy + 2} width={Math.max(1, (plotW * b.value) / (max || 1))} height={11} fill={b.color} rx={1.5} />
              <SText x={labelW + Math.max(1, (plotW * b.value) / (max || 1)) + 5} y={yy + 11} fontSize={8} fill={C.muted}>
                {b.text}
              </SText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const stageColor: Record<StageCount["stage"], string> = {
  new: C.incoming,
  attempted: C.attempted,
  connected: C.done,
  closed: C.closed,
};

const pct = (n: number | null) => (n === null ? "-" : `${n}%`);
const hourText = (h: number | null) => (h === null ? "-" : `${String(h).padStart(2, "0")}:00`);

export function ReportDocument({ data }: { data: ReportData }) {
  const { options: o } = data;
  const has = (x: ReportSection) => o.sections.includes(x);
  const sum = data.summary.total;
  const rated = data.agents.filter((a) => a.pickupRate !== null);

  return (
    <Document title="IVR CRM membership report" author="IVR CRM">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Membership calling report</Text>
        <Text style={s.sub}>
          {o.fromLabel} to {o.toLabel} (Indian Standard Time) - {o.scopeLabel}
        </Text>
        <Text style={s.sub}>
          Generated {data.generatedAt} by {o.generatedBy}
        </Text>
        <View style={s.rule} />

        {has("summary") && (
          <View>
            <View style={s.kpis}>
              <Kpi label="Calls" value={String(sum.calls)} />
              <Kpi label="Answered" value={String(sum.answered)} color={C.done} />
              <Kpi label="Not answered" value={String(sum.notAnswered)} color={C.missed} />
              <Kpi label="Answer rate" value={pct(sum.rate)} />
              <Kpi label="Members called" value={String(sum.members)} />
              <Kpi label="Talk time" value={formatDuration(sum.talkSec)} />
            </View>
            <Text style={s.h2}>Inbound and outbound</Text>
            <Table
              rows={[
                ["Outbound", data.summary.outbound] as const,
                ["Inbound", data.summary.inbound] as const,
                ["Total", data.summary.total] as const,
              ]}
              cols={[
                { label: "Direction", w: 2, cell: (r) => r[0] },
                { label: "Calls", w: 1.2, align: "right", cell: (r) => String(r[1].calls) },
                { label: "Answered", w: 1.4, align: "right", cell: (r) => String(r[1].answered) },
                { label: "Rate", w: 1.1, align: "right", cell: (r) => pct(r[1].rate) },
                { label: "Members", w: 1.4, align: "right", cell: (r) => String(r[1].members) },
                { label: "Reached", w: 1.3, align: "right", cell: (r) => String(r[1].membersReached) },
                { label: "Talk time", w: 1.6, align: "right", cell: (r) => formatDuration(r[1].talkSec) },
                { label: "Avg talk", w: 1.5, align: "right", cell: (r) => formatDuration(r[1].avgTalkSec) },
                { label: "Median", w: 1.5, align: "right", cell: (r) => formatDuration(r[1].medianTalkSec) },
                { label: "Avg ring", w: 1.4, align: "right", cell: (r) => formatDuration(r[1].avgRingSec) },
              ]}
            />
            <Text style={s.note}>Members counts distinct phone numbers; in the Total row a number seen in both directions counts once.</Text>
          </View>
        )}

        {has("agents") && (
          <View>
            <Text style={s.h2}>Agents</Text>
            {data.agents.length ? (
              <Table
                rows={data.agents}
                cols={[
                  { label: "Agent", w: 3, cell: (a) => a.name },
                  { label: "Allocated", w: 1.4, align: "right", cell: (a) => String(a.assigned) },
                  { label: "Out", w: 1, align: "right", cell: (a) => String(a.outbound) },
                  { label: "In", w: 1, align: "right", cell: (a) => String(a.inbound) },
                  { label: "Answered", w: 1.4, align: "right", cell: (a) => String(a.answered) },
                  { label: "Pick-up", w: 1.2, align: "right", cell: (a) => pct(a.pickupRate) },
                  { label: "Talk time", w: 1.6, align: "right", cell: (a) => formatDuration(a.talkSec) },
                  { label: "Avg talk", w: 1.5, align: "right", cell: (a) => formatDuration(a.avgTalkSec) },
                  { label: "Members", w: 1.3, align: "right", cell: (a) => String(a.membersCalled) },
                ]}
              />
            ) : (
              <Text style={s.note}>No agents matched this report scope.</Text>
            )}
            <Text style={s.note}>Allocated counts members given to the agent in this period. Pick-up is answered outbound calls over outbound calls.</Text>
          </View>
        )}

        {has("charts") && (
          <View>
            <Text style={s.h2}>Calls per day</Text>
            {data.perDay.some((d) => d.answered + d.notAnswered > 0) ? <DayChart data={data.perDay} /> : <Text style={s.note}>No calls in this period.</Text>}

            <Text style={s.h2}>Pick-up rate by agent</Text>
            {rated.length ? (
              <HBarChart
                max={100}
                bars={[...rated]
                  .sort((a, b) => (b.pickupRate ?? 0) - (a.pickupRate ?? 0))
                  .map((a) => ({ label: a.name, value: a.pickupRate ?? 0, text: `${a.pickupRate}% of ${a.outbound}`, color: C.accent }))}
              />
            ) : (
              <Text style={s.note}>No outbound calls to rank.</Text>
            )}

            <Text style={s.h2}>Members by stage (now)</Text>
            <HBarChart
              max={Math.max(1, ...data.stages.map((x) => x.n))}
              bars={data.stages.map((x) => ({ label: STAGES[x.stage].label, value: x.n, text: String(x.n), color: stageColor[x.stage] }))}
            />
          </View>
        )}

        {has("categories") && (
          <View>
            <Text style={s.h2}>Calls by category</Text>
            {data.categories.length ? (
              <Table
                rows={data.categories}
                cols={[
                  { label: "Category", w: 3.2, cell: (c) => c.label },
                  { label: "Calls", w: 1.2, align: "right", cell: (c) => String(c.calls) },
                  { label: "Out", w: 1, align: "right", cell: (c) => String(c.outbound) },
                  { label: "In", w: 1, align: "right", cell: (c) => String(c.inbound) },
                  { label: "Answered", w: 1.4, align: "right", cell: (c) => String(c.answered) },
                  { label: "Rate", w: 1.1, align: "right", cell: (c) => pct(c.rate) },
                  { label: "Talk time", w: 1.6, align: "right", cell: (c) => formatDuration(c.talkSec) },
                  { label: "Avg talk", w: 1.5, align: "right", cell: (c) => formatDuration(c.avgTalkSec) },
                ]}
              />
            ) : (
              <Text style={s.note}>No calls in this period.</Text>
            )}
          </View>
        )}

        {has("numbers") && data.numbers && (
          <View>
            <Text style={s.h2}>Answer rate by number</Text>
            {data.numbers.rows.length ? (
              <Table
                rows={data.numbers.rows}
                cols={[
                  { label: "Number", w: 2.4, cell: (r) => formatPhone(r.number) },
                  { label: "Member", w: 2.6, cell: (r) => r.member || "-" },
                  { label: "Calls", w: 1, align: "right", cell: (r) => String(r.attempts) },
                  { label: "Answered", w: 1.3, align: "right", cell: (r) => String(r.answered) },
                  { label: "Rate", w: 1, align: "right", cell: (r) => `${r.rate}%` },
                  { label: "Avg talk", w: 1.4, align: "right", cell: (r) => (r.avgTalkSec ? formatDuration(r.avgTalkSec) : "-") },
                  { label: "Best hour", w: 1.3, align: "right", cell: (r) => hourText(r.bestHour) },
                ]}
              />
            ) : (
              <Text style={s.note}>No calls in this period.</Text>
            )}
            <Text style={s.note}>
              The {NUMBER_LIST_CAP} most-called numbers{data.numbers.truncated ? "" : " (all of them)"}. The full list is a CSV download on the Analytics page.
            </Text>
          </View>
        )}

        {has("assignments") && (
          <View>
            <Text style={s.h2}>Allocations and reallocations</Text>
            <Text style={[s.note, { marginTop: 0, marginBottom: 4 }]}>
              {data.assignments.totalAssigned} member allocations in this period, {data.assignments.totalReassigned} of them reassignments.
            </Text>
            <Table
              rows={data.assignments.rows.filter((r) => r.received || r.reassignedAway)}
              cols={[
                { label: "Agent", w: 4, cell: (r) => r.name },
                { label: "Received", w: 1.5, align: "right", cell: (r) => String(r.received) },
                { label: "Moved away", w: 1.5, align: "right", cell: (r) => String(r.reassignedAway) },
              ]}
            />
            {!data.assignments.rows.some((r) => r.received || r.reassignedAway) && (
              <Text style={s.note}>No members were allocated in this period.</Text>
            )}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>IVR CRM - {o.fromLabel} to {o.toLabel}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {has("calls") && data.calls && (
        <Page size="A4" style={s.page}>
          <Text style={s.title}>Call list</Text>
          <Text style={s.sub}>
            {data.calls.rows.length} calls, newest first
            {data.calls.truncated ? ` (limited to the latest ${CALL_LIST_CAP}; narrow the dates to see the rest)` : ""}
          </Text>
          <View style={{ marginTop: 8 }}>
            <Table
              rows={data.calls.rows}
              cols={[
                { label: "Time", w: 2.2, cell: (r) => r.startedAt },
                { label: "Number", w: 2.2, cell: (r) => formatPhone(r.customerNumber) },
                { label: "Member", w: 2.2, cell: (r) => r.member || "-" },
                { label: "Agent", w: 2, cell: (r) => r.agent || "-" },
                { label: "Dir.", w: 0.9, cell: (r) => (r.direction === "outbound" ? "Out" : "In") },
                { label: "Result", w: 1.5, cell: (r) => r.outcome.replace(/_/g, " ") },
                { label: "Category", w: 2, cell: (r) => r.category || "-" },
                { label: "Talk", w: 1.2, align: "right", cell: (r) => formatDuration(r.answeredSec) },
              ]}
            />
          </View>
          <View style={s.footer} fixed>
            <Text>IVR CRM - {o.fromLabel} to {o.toLabel}</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      )}
    </Document>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiL}>{label}</Text>
      <Text style={[s.kpiV, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  return renderToBuffer(<ReportDocument data={data} />);
}
