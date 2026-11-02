"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import type { ActionResult } from "@/lib/design/dal";
import {
  addHolidayAction,
  addLeaveAction,
  checkStorageAction,
  deleteAllDataAction,
  removeHolidayAction,
  removeLeaveAction,
  saveCapacityAction,
  saveGeneralAction,
  saveScheduleAction,
  saveSlackAction,
  saveTypeAction,
  testEmailAction,
  testSlackAction,
} from "@/lib/design/actions/admin";
import { Badge, Card, formatDay } from "../../ui";

/** The settings tabs' forms. Each saves through its own server action and refreshes the page; problems come back as a toast. */

function useSave() {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const save = <T,>(fn: () => Promise<ActionResult<T>>, done?: (data: T) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      done?.(r.data);
      router.refresh();
    });
  return { busy, save, toast };
}

const Spin = ({ on }: { on: boolean }) => (on ? <Loader2 size={14} className="animate-spin" /> : null);

// ── Design types ─────────────────────────────────────────────────────────────

export type TypeRow = { id: string; name: string; slaHours: number; effortHours: number; editWindowHours: number | null; isActive: boolean; questions: number };
type TypeDraft = { id: string | null; name: string; slaHours: string; effortHours: string; editWindowHours: string; isActive: boolean };

export function TypesPanel({ types }: { types: TypeRow[] }) {
  const { busy, save } = useSave();
  const [draft, setDraft] = useState<TypeDraft | null>(null);
  const edit = (t: TypeRow | null) =>
    setDraft(t ? { id: t.id, name: t.name, slaHours: String(t.slaHours), effortHours: String(t.effortHours), editWindowHours: t.editWindowHours ? String(t.editWindowHours) : "", isActive: t.isActive } : { id: null, name: "", slaHours: "48", effortHours: "4", editWindowHours: "", isActive: true });
  const submit = () =>
    draft &&
    save(
      () => saveTypeAction(draft.id, { name: draft.name, slaHours: Number(draft.slaHours), effortHours: Number(draft.effortHours), editWindowHours: draft.editWindowHours === "" ? "" : Number(draft.editWindowHours), isActive: draft.isActive }),
      () => setDraft(null),
    );
  const toggle = (t: TypeRow) => save(() => saveTypeAction(t.id, { name: t.name, slaHours: t.slaHours, effortHours: t.effortHours, editWindowHours: t.editWindowHours ?? "", isActive: !t.isActive }));
  return (
    <Card
      title="Design types"
      pad={false}
      actions={
        <button type="button" className="btn btn-sm ds-btn-navy" onClick={() => edit(null)}>
          <Plus size={14} /> Add a type
        </button>
      }
    >
      <p className="px-5 pt-4 text-sm ds-muted">Turnaround sets the deadline for new versions (urgent work gets half). Effort is the typical hands-on time, used for workload and auto-assignment.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left">
              <th className="ds-label px-5 py-2.5">Name</th>
              <th className="ds-label px-3 py-2.5 text-right">Turnaround</th>
              <th className="ds-label px-3 py-2.5 text-right">Effort</th>
              <th className="ds-label px-3 py-2.5 text-right">Edit window</th>
              <th className="ds-label px-3 py-2.5">Status</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ds-line)]">
            {types.map((t) => (
              <tr key={t.id} className={t.isActive ? "" : "opacity-60"}>
                <td className="px-5 py-2.5 font-semibold text-ink">
                  {t.name}
                  <span className="block text-xs font-normal ds-muted">{t.questions} question{t.questions === 1 ? "" : "s"} on the form</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{t.slaHours}h</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{t.effortHours}h</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{t.editWindowHours ? `${t.editWindowHours}h` : <span className="ds-muted">default</span>}</td>
                <td className="px-3 py-2.5">{t.isActive ? <Badge tone="green">Offered</Badge> : <Badge tone="neutral">Off</Badge>}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(t)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(t)}>
                    {t.isActive ? "Switch off" : "Switch on"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && (
        <Modal title={draft.id ? `Edit ${draft.name || "type"}` : "Add a design type"} onClose={() => setDraft(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="ds-label">Name</span>
              <input className="input" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="ds-label">Turnaround (working hours)</span>
              <input className="input" type="number" min={1} value={draft.slaHours} onChange={(e) => setDraft({ ...draft, slaHours: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="ds-label">Typical effort (hours)</span>
              <input className="input" type="number" min={0.5} step={0.5} value={draft.effortHours} onChange={(e) => setDraft({ ...draft, effortHours: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="ds-label">Edit window (hours, blank = default)</span>
              <input className="input" type="number" min={1} value={draft.editWindowHours} onChange={(e) => setDraft({ ...draft, editWindowHours: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold text-ink">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Offered on the request form
            </label>
          </div>
          {!draft.id && <p className="mt-3 text-xs ds-muted">A new type asks only the language question on the form.</p>}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm ds-btn-navy" disabled={busy} onClick={submit}>
              <Spin on={busy} /> Save
            </button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ── Working schedule ─────────────────────────────────────────────────────────

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function SchedulePanel({ days }: { days: { dayOfWeek: number; isWorking: boolean; startHour: number; endHour: number }[] }) {
  const { busy, save } = useSave();
  const [rows, setRows] = useState(days);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card title="Working schedule">
      <p className="mb-4 text-sm ds-muted">Deadlines count only these hours (IST). Holidays are skipped too.</p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.dayOfWeek} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--ds-line)] px-3 py-2">
            <label className="flex w-36 items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={r.isWorking} onChange={(e) => set(i, { isWorking: e.target.checked })} />
              {DAYS[r.dayOfWeek]}
            </label>
            {r.isWorking ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <span className="ds-muted">From</span>
                  <select className="input !py-1.5" value={r.startHour} onChange={(e) => set(i, { startHour: Number(e.target.value) })} aria-label={`${DAYS[r.dayOfWeek]} start`}>
                    {HOURS.slice(0, 24).map((h) => (
                      <option key={h} value={h}>
                        {hourText(h)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span className="ds-muted">to</span>
                  <select className="input !py-1.5" value={r.endHour} onChange={(e) => set(i, { endHour: Number(e.target.value) })} aria-label={`${DAYS[r.dayOfWeek]} end`}>
                    {HOURS.slice(1).map((h) => (
                      <option key={h} value={h}>
                        {hourText(h)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <span className="text-sm ds-muted">Not a working day</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" className="btn btn-sm ds-btn-navy" disabled={busy} onClick={() => save(() => saveScheduleAction(rows))}>
          <Spin on={busy} /> Save schedule
        </button>
      </div>
    </Card>
  );
}

// ── Holidays ─────────────────────────────────────────────────────────────────

export function HolidaysPanel({ holidays }: { holidays: { id: string; date: string; name: string; type: "national" | "company" | "optional" }[] }) {
  const { busy, save } = useSave();
  const confirm = useConfirm();
  const [form, setForm] = useState({ date: "", name: "", type: "national" as "national" | "company" | "optional" });
  const remove = async (h: (typeof holidays)[number]) => {
    if (await confirm({ title: "Remove this holiday?", message: `${h.name} on ${formatDay(h.date)} will count as a working day again.`, confirmLabel: "Remove", danger: true })) save(() => removeHolidayAction(h.id));
  };
  return (
    <Card title="Holidays">
      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save(() => addHolidayAction(form.date, form.name, form.type), () => setForm({ date: "", name: "", type: "national" }));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="ds-label">Date</span>
          <input type="date" className="input !py-2" value={form.date} required onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="ds-label">Name</span>
          <input className="input !py-2" value={form.name} required maxLength={80} placeholder="Diwali" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">Type</span>
          <select className="input !py-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>
            <option value="national">National</option>
            <option value="company">Company</option>
            <option value="optional">Optional</option>
          </select>
        </label>
        <button type="submit" className="btn btn-sm ds-btn-navy" disabled={busy}>
          <Spin on={busy} /> <Plus size={14} /> Add holiday
        </button>
      </form>
      {holidays.length === 0 ? (
        <p className="text-sm ds-muted">No holidays yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--ds-line)] rounded-lg border border-[var(--ds-line)]">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-32 font-semibold tabular-nums text-ink">{formatDay(h.date)}</span>
              <span className="flex-1 text-ink">{h.name}</span>
              <Badge tone={h.type === "national" ? "blue" : h.type === "company" ? "green" : "neutral"}>{h.type === "national" ? "National" : h.type === "company" ? "Company" : "Optional"}</Badge>
              <button type="button" className="rounded p-1.5 text-subtle hover:bg-alt hover:text-[var(--ds-red)]" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Team: capacity and leave ─────────────────────────────────────────────────

export type TeamRow = { id: string; name: string; email: string; dailyHours: number; leaves: { id: string; startDate: string; endDate: string; note: string | null }[] };

function TeamMember({ m }: { m: TeamRow }) {
  const { busy, save } = useSave();
  const confirm = useConfirm();
  const [hours, setHours] = useState(String(m.dailyHours));
  const [leave, setLeave] = useState({ start: "", end: "", note: "" });
  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{m.name}</span>
          <span className="block text-xs ds-muted">{m.email}</span>
        </span>
        <label className="flex items-center gap-2 text-sm">
          <span className="ds-muted">Hours a day</span>
          <input className="input !w-20 !py-1.5" type="number" min={0} max={16} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || Number(hours) === m.dailyHours} onClick={() => save(() => saveCapacityAction(m.id, Number(hours)))}>
          Save
        </button>
      </div>
      <div className="flex flex-col gap-2 pl-0 sm:pl-4">
        {m.leaves.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {m.leaves.map((l) => (
              <li key={l.id} className="flex items-center gap-1.5 rounded-full border border-[var(--ds-line)] bg-[var(--ds-grey-tint)] py-1 pl-3 pr-1 text-xs">
                <span className="font-semibold text-ink">
                  {formatDay(l.startDate)}
                  {l.endDate !== l.startDate ? ` – ${formatDay(l.endDate)}` : ""}
                </span>
                {l.note && <span className="ds-muted">· {l.note}</span>}
                <button
                  type="button"
                  className="rounded-full p-1 text-subtle hover:bg-white hover:text-[var(--ds-red)]"
                  aria-label={`Remove leave from ${formatDay(l.startDate)}`}
                  onClick={async () => (await confirm({ title: "Remove this leave?", message: `${m.name} will count as available on those days.`, confirmLabel: "Remove", danger: true })) && save(() => removeLeaveAction(l.id))}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(() => addLeaveAction(m.id, leave.start, leave.end || leave.start, leave.note), () => setLeave({ start: "", end: "", note: "" }));
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="ds-label">Leave from</span>
            <input type="date" className="input !py-1.5" required value={leave.start} onChange={(e) => setLeave({ ...leave, start: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">To</span>
            <input type="date" className="input !py-1.5" value={leave.end} min={leave.start || undefined} onChange={(e) => setLeave({ ...leave, end: e.target.value })} />
          </label>
          <label className="flex min-w-[140px] flex-1 flex-col gap-1">
            <span className="ds-label">Note</span>
            <input className="input !py-1.5" maxLength={200} value={leave.note} onChange={(e) => setLeave({ ...leave, note: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-ghost btn-sm" disabled={busy}>
            <Plus size={14} /> Add leave
          </button>
        </form>
      </div>
    </li>
  );
}

export function TeamPanel({ team }: { team: TeamRow[] }) {
  return (
    <Card title="Team capacity and leave" pad={false}>
      <p className="px-5 pt-4 text-sm ds-muted">Hours a day each designer can design, and their leave. Used by the workload grid and auto-assignment.</p>
      {team.length === 0 ? (
        <p className="px-5 py-6 text-sm ds-muted">Nobody has Design Team yet. Give designers the Design Team application in Administrator → Applications.</p>
      ) : (
        <ul className="divide-y divide-[var(--ds-line)]">
          {team.map((m) => (
            <TeamMember key={m.id} m={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── General ──────────────────────────────────────────────────────────────────

export function GeneralPanel({ settings }: { settings: { editWindowHours: number; maxFreeRevisions: number; ticketNumberFloor: number } }) {
  const { busy, save } = useSave();
  const [f, setF] = useState({ editWindowHours: String(settings.editWindowHours), maxFreeRevisions: String(settings.maxFreeRevisions), ticketNumberFloor: String(settings.ticketNumberFloor) });
  const field = (k: keyof typeof f, label: string, hint: string, min: number) => (
    <label className="flex flex-col gap-1.5">
      <span className="ds-label">{label}</span>
      <input className="input" type="number" min={min} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <span className="text-xs ds-muted">{hint}</span>
    </label>
  );
  return (
    <Card title="General">
      <div className="grid gap-5 sm:grid-cols-3">
        {field("editWindowHours", "Edit window (hours)", "After a design is delivered, how long before the ticket closes itself. Default 48.", 1)}
        {field("maxFreeRevisions", "Free revisions", 'Change rounds before a new version is tagged "Extra revision". Default 2.', 0)}
        {field("ticketNumberFloor", "Ticket number floor", `The last number used (next is DF-${String(Number(f.ticketNumberFloor || 0) + 1).padStart(4, "0")}). It can only go up.`, settings.ticketNumberFloor)}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="btn btn-sm ds-btn-navy"
          disabled={busy}
          onClick={() => save(() => saveGeneralAction({ editWindowHours: Number(f.editWindowHours), maxFreeRevisions: Number(f.maxFreeRevisions), ticketNumberFloor: Number(f.ticketNumberFloor) }))}
        >
          <Spin on={busy} /> Save
        </button>
      </div>
    </Card>
  );
}

// ── Integrations (Support Admin) ─────────────────────────────────────────────

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--ds-line)] py-4 last:border-0">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function IntegrationsPanel({ storageConfigured, slack, slackEvents }: { storageConfigured: boolean; slack: { webhook: string; events: Record<string, boolean> }; slackEvents: Record<string, string> }) {
  const { busy, save, toast } = useSave();
  const [storage, setStorage] = useState<{ ok: boolean; message: string } | null>(null);
  const [webhook, setWebhook] = useState(slack.webhook);
  const [events, setEvents] = useState(slack.events);
  const [danger, setDanger] = useState(false);
  const [typed, setTyped] = useState("");
  return (
    <div className="flex flex-col gap-5">
      <Card title="Integrations">
        <Row title="File storage (Supabase Storage)">
          <p className="text-sm ds-muted">{storageConfigured ? "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set." : "Not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and create the private bucket design-files."}</p>
          {storage && <p className={`text-sm font-semibold ${storage.ok ? "text-[var(--ds-green-text)]" : "text-[var(--ds-red)]"}`}>{storage.message}</p>}
          <div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(() => checkStorageAction(), (d) => setStorage(d))}>
              Check storage
            </button>
          </div>
        </Row>
        <Row title="Email">
          <p className="text-sm ds-muted">DesignDesk sends email through the hub&apos;s SMTP settings.</p>
          <div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(() => testEmailAction(), (d) => toast.success(d))}>
              Send me a test email
            </button>
          </div>
        </Row>
        <Row title="Slack (optional)">
          <label className="flex flex-col gap-1.5">
            <span className="ds-label">Incoming webhook URL</span>
            <input className="input" placeholder="https://hooks.slack.com/services/..." value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          </label>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="sr-only">Post to Slack when</legend>
            {Object.entries(slackEvents).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={!!events[k]} onChange={(e) => setEvents({ ...events, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </fieldset>
          <p className="text-xs ds-muted">Leave the address empty to switch Slack off.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm ds-btn-navy" disabled={busy} onClick={() => save(() => saveSlackAction(webhook, events))}>
              <Spin on={busy} /> Save Slack
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !slack.webhook} onClick={() => save(() => testSlackAction(), (d) => toast.success(d))}>
              Send test
            </button>
          </div>
        </Row>
      </Card>
      <section className="ds-card border-[rgba(220,38,38,0.35)] p-5">
        <h2 className="text-[1.02rem] font-bold text-[var(--ds-red)]">Danger zone</h2>
        <p className="mt-1 text-sm ds-muted">Delete every ticket, proof, file, library item, campaign and saved view, and every stored file. Design types, the schedule, holidays, leave and settings stay; ticket numbers carry on. This cannot be undone.</p>
        <button type="button" className="btn btn-danger btn-sm mt-4" onClick={() => setDanger(true)}>
          Delete all past data
        </button>
      </section>
      {danger && (
        <Modal title="Delete all past data?" onClose={() => setDanger(false)}>
          <p className="text-sm text-ink">Everything listed in the danger zone is removed for good. Type DELETE to confirm.</p>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="ds-label">Type DELETE</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDanger(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy || typed.trim() !== "DELETE"}
              onClick={() =>
                save(
                  () => deleteAllDataAction(typed),
                  (d) => {
                    toast.success(`Deleted ${d.tickets} ticket${d.tickets === 1 ? "" : "s"} and ${d.files} file${d.files === 1 ? "" : "s"}.`);
                    setDanger(false);
                    setTyped("");
                  },
                )
              }
            >
              <Spin on={busy} /> Delete everything
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
