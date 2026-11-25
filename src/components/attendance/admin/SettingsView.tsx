"use client";

import { useState } from "react";
import { CalendarDays, Clock, HardDrive, Info, MapPin, Trash2, Wifi } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import type { LeaveType, Shift, Holiday } from "@/db/attendance-schema";
import {
  checkStorageAction,
  deleteHolidayAction,
  deleteLeaveTypeAction,
  deleteShiftAction,
  saveHolidayAction,
  saveLeaveTypeAction,
  saveSettingsAction,
  saveShiftAction,
} from "@/lib/attendance/actions/admin";
import type { AttSettings } from "@/lib/attendance/settings";
import { isIpEntry } from "@/lib/attendance/settings";
import { EMPLOYMENT_LABEL, EMPLOYMENT_TYPES, LEAVE_COLORS, leaveColor } from "@/lib/attendance/att.manifest";
import { formatDayShort } from "@/lib/attendance/time";
import { Badge, Card, Field } from "../ui";
import { useAct } from "../use-act";
import { TimePicker } from "../TimePicker";

/** The office network addresses a laptop may check in from (also on People). */
export function IpEditor({ settings }: { settings: AttSettings }) {
  const { act, pending } = useAct();
  const [ip, setIp] = useState("");
  const save = (officeIps: string[]) => act(() => saveSettingsAction({ ...settings, officeIps }));
  return (
    <Card title="Office IPs (laptop check-in)" icon={Wifi} iconTone="blue">
      <p className="mb-3 text-sm att-muted">
        Anyone whose connection comes from one of these addresses can check in from a laptop, without location. Enter the office&apos;s public IP (ask IT, or open “what is my IP” on the office Wi-Fi), or an IPv4 range like 203.0.113.0/28.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = ip.trim();
          if (!isIpEntry(v)) return;
          const r = await save([...settings.officeIps, v]);
          if (r.ok) setIp("");
        }}
      >
        <input className="input max-w-xs" placeholder="e.g. 203.0.113.10" value={ip} onChange={(e) => setIp(e.target.value)} aria-label="Office IP" />
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !isIpEntry(ip.trim())}>
          Add IP
        </button>
      </form>
      {ip.trim() && !isIpEntry(ip.trim()) && <p className="mt-1 text-xs text-[var(--att-red)]">Not a valid IP address or IPv4 range.</p>}
      <ul className="mt-3 flex flex-wrap gap-2">
        {settings.officeIps.length === 0 && <li className="text-sm att-muted">None yet: only phone location (GPS) check-in works until one is added.</li>}
        {settings.officeIps.map((x) => (
          <li key={x} className="att-badge att-tone-primary font-mono">
            {x}
            <button type="button" aria-label={`Remove ${x}`} disabled={pending} onClick={() => save(settings.officeIps.filter((y) => y !== x))}>
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Everything else in Settings. */
export function SettingsView({ settings, shifts, leaveTypes, holidays, year, setup }: { settings: AttSettings; shifts: Shift[]; leaveTypes: LeaveType[]; holidays: Holiday[]; year: number; setup: { user: boolean; admin: boolean } }) {
  return (
    <div className="flex flex-col gap-5">
      {(!setup.user || !setup.admin) && (
        <Card title="Setup" icon={Info} iconTone="orange">
          <p className="text-sm">
            Add {!setup.user && <strong>“Attendance” (URL /attendance)</strong>}
            {!setup.user && !setup.admin && " and "}
            {!setup.admin && <strong>“Attendance Admin” (URL /attendance/admin)</strong>} in Administrator → Applications. Staff get the Attendance tile; HR are App Admins of Attendance Admin.
          </p>
        </Card>
      )}
      <General settings={settings} />
      <IpEditor settings={settings} />
      <Shifts shifts={shifts} />
      <LeaveTypes types={leaveTypes} />
      <Holidays holidays={holidays} year={year} />
      <StorageCheck />
    </div>
  );
}

function General({ settings: s }: { settings: AttSettings }) {
  const { act, pending } = useAct();
  return (
    <Card title="Office, rules and reminders" icon={MapPin} iconTone="green">
      <form
        className="grid gap-5"
        action={async (f) => {
          const n = (k: string) => Number(f.get(k));
          await act(() =>
            saveSettingsAction({
              ...s,
              office: { name: String(f.get("officeName") ?? ""), lat: n("lat"), lng: n("lng"), radiusM: n("radius") },
              regularizationWindowDays: n("window"),
              earlyOutMinutes: n("early"),
              compoffExpiryDays: n("expiry"),
              offSaturdays: [1, 2, 3, 4, 5].filter((i) => f.get(`sat${i}`) === "on"),
              reminders: { enabled: f.get("remind") === "on", checkIn: String(f.get("remIn") ?? ""), checkOut: String(f.get("remOut") ?? "") },
              emailEnabled: f.get("email") === "on",
              goLiveDate: String(f.get("goLive") ?? "") || null,
            }),
          );
        }}
      >
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-bold text-ink">Office location (phone check-in)</legend>
          <div className="sm:col-span-4">
            <Field label="Name">
              <input name="officeName" className="input" defaultValue={s.office.name} maxLength={120} />
            </Field>
          </div>
          <Field label="Latitude">
            <input name="lat" type="number" step="0.000001" min={-90} max={90} className="input" defaultValue={s.office.lat} required />
          </Field>
          <Field label="Longitude">
            <input name="lng" type="number" step="0.000001" min={-180} max={180} className="input" defaultValue={s.office.lng} required />
          </Field>
          <Field label="Radius (metres)">
            <input name="radius" type="number" min={25} max={5000} className="input" defaultValue={s.office.radiusM} required />
          </Field>
          <div className="flex items-end">
            <a className="text-sm font-semibold text-[var(--att-primary)]" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${s.office.lat}&mlon=${s.office.lng}#map=17/${s.office.lat}/${s.office.lng}`}>
              Check on a map →
            </a>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-bold text-ink">Go-live</legend>
          <Field
            label="Attendance counts from"
            hint={
              s.goLiveDate
                ? "Days before this are not tracked: shown as “—”, never absent, not in the reports."
                : `Not set: counting from ${s.firstEnabledOn ? formatDayShort(s.firstEnabledOn) : "today"}, the day Attendance was first switched on.`
            }
          >
            <input name="goLive" type="date" className="input" defaultValue={s.goLiveDate ?? ""} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-bold text-ink">Rules</legend>
          <Field label="Regularization window (days)">
            <input name="window" type="number" min={1} max={90} className="input" defaultValue={s.regularizationWindowDays} required />
          </Field>
          <Field label="Early out: minutes before shift end">
            <input name="early" type="number" min={0} max={240} className="input" defaultValue={s.earlyOutMinutes} required />
          </Field>
          <Field label="Comp-off expires after (days)">
            <input name="expiry" type="number" min={7} max={365} className="input" defaultValue={s.compoffExpiryDays} required />
          </Field>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-bold text-ink">Working schedule: which Saturdays are off</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {[1, 2, 3, 4, 5].map((i) => (
              <label key={i} className="inline-flex items-center gap-1.5">
                <input type="checkbox" name={`sat${i}`} defaultChecked={s.offSaturdays.includes(i)} /> {["1st", "2nd", "3rd", "4th", "5th"][i - 1]} Saturday off
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs att-muted">Sundays are always off. The usual rule is 2nd and 4th off (1st, 3rd and 5th working).</p>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-bold text-ink">Reminders and email</legend>
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="remind" defaultChecked={s.reminders.enabled} /> Send check-in and check-out reminders on the bell
          </label>
          <TimePicker label="Check-in reminder at" name="remIn" defaultValue={s.reminders.checkIn} />
          <TimePicker label="Check-out reminder at" name="remOut" defaultValue={s.reminders.checkOut} />
          <span />
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="email" defaultChecked={s.emailEnabled} /> Also email approvers about new requests and requesters about decisions (the bell is always used)
          </label>
        </fieldset>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Save settings
          </button>
        </div>
      </form>
    </Card>
  );
}

function Shifts({ shifts }: { shifts: Shift[] }) {
  const { act, pending } = useAct();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);
  return (
    <Card title="Shifts" icon={Clock} iconTone="purple" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({})}>Add shift</button>} pad={false}>
      <ul className="divide-y divide-[var(--att-line)]">
        {shifts.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
            <span className="flex-1">
              <span className="font-semibold">{s.name}</span> {s.isDefault && <Badge tone="blue">Default</Badge>}
              <span className="block text-xs att-muted">
                {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)} · grace {s.graceMinutes} min · full day {Number(s.fullDayHours)} h · half day {Number(s.halfDayHours)} h · halves split at {s.firstHalfEnd.slice(0, 5)}
              </span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
              Edit
            </button>
            {!s.isDefault && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-[var(--att-red)]"
                disabled={pending}
                onClick={async () => {
                  if (await confirm({ title: `Delete ${s.name}?`, message: "People on it move to the default shift.", confirmLabel: "Delete", danger: true })) await act(() => deleteShiftAction(s.id));
                }}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : "Add shift"} onClose={() => setEditing(null)}>
          <form
            className="grid gap-3"
            action={async (f) => {
              const g = (k: string) => String(f.get(k) ?? "");
              const r = await act(() =>
                saveShiftAction({
                  id: editing.id,
                  name: g("name"),
                  startTime: g("start"),
                  endTime: g("end"),
                  graceMinutes: Number(g("grace")),
                  fullDayHours: Number(g("full")),
                  halfDayHours: Number(g("half")),
                  firstHalfEnd: g("fhe"),
                  secondHalfStart: g("shs"),
                  isDefault: f.get("isDefault") === "on",
                }),
              );
              if (r.ok) setEditing(null);
            }}
          >
            <Field label="Name">
              <input name="name" className="input" defaultValue={editing.name ?? ""} required maxLength={60} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <TimePicker label="Starts" name="start" defaultValue={editing.startTime?.slice(0, 5) ?? "10:00"} />
              <TimePicker label="Ends" name="end" defaultValue={editing.endTime?.slice(0, 5) ?? "17:30"} />
              <TimePicker label="First half ends" name="fhe" defaultValue={editing.firstHalfEnd?.slice(0, 5) ?? "14:00"} />
              <TimePicker label="Second half starts" name="shs" defaultValue={editing.secondHalfStart?.slice(0, 5) ?? "14:00"} />
              <Field label="Grace (minutes)">
                <input name="grace" type="number" min={0} max={240} className="input" defaultValue={editing.graceMinutes ?? 45} required />
              </Field>
              <span />
              <Field label="Full-day hours">
                <input name="full" type="number" step="0.25" min={0.5} max={24} className="input" defaultValue={editing.fullDayHours ?? 7.5} required />
              </Field>
              <Field label="Half-day hours">
                <input name="half" type="number" step="0.25" min={0.25} max={24} className="input" defaultValue={editing.halfDayHours ?? 4} required />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="isDefault" defaultChecked={!!editing.isDefault} /> Default shift (for anyone without one)
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function LeaveTypes({ types }: { types: LeaveType[] }) {
  const { act, pending } = useAct();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<LeaveType> | null>(null);
  return (
    <Card title="Leave types" icon={CalendarDays} iconTone="blue" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({})}>Add leave type</button>} pad={false}>
      <ul className="divide-y divide-[var(--att-line)]">
        {types.map((t) => (
          <li key={t.id} className={`flex flex-wrap items-center gap-2 px-5 py-3 text-sm ${t.isActive ? "" : "opacity-60"}`}>
            <span className="h-3 w-3 rounded-full" style={{ background: leaveColor(t.color) }} aria-hidden />
            <span className="flex-1">
              <span className="font-semibold">{t.name}</span> {!t.isActive && <Badge>Off</Badge>}
              <span className="block text-xs att-muted">
                {t.isCompoff
                  ? "Earned comp-offs only"
                  : [
                      `${Number(t.daysPerYear)} days/year (${t.accrualType === "monthly" ? "monthly" : "all at once"})`,
                      Number(t.carryForwardCap) > 0 ? `carry up to ${Number(t.carryForwardCap)}` : null,
                      t.noticePeriodDays ? `${t.noticePeriodDays} days' notice` : "no notice",
                      t.allowHalfDay ? "half days" : null,
                      t.requiresDocumentAfterDays != null ? `document after ${t.requiresDocumentAfterDays} days` : null,
                      t.maxConsecutiveDays ? `max ${t.maxConsecutiveDays} in a row` : null,
                      t.availableTo !== "all" ? `${t.availableTo} only` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-[var(--att-red)]"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: `Delete ${t.name}?`, message: "If anyone has used it, it is switched off instead so their history stays.", confirmLabel: "Delete", danger: true }))
                  await act(() => deleteLeaveTypeAction(t.id).then((r) => (r.ok ? { ...r, message: r.data === "deleted" ? "Leave type deleted" : "It has been used, so it was switched off instead" } : r)));
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {editing && <LeaveTypeDialog t={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function LeaveTypeDialog({ t, onClose }: { t: Partial<LeaveType>; onClose: () => void }) {
  const { act, pending } = useAct();
  const [compoff, setCompoff] = useState(!!t.isCompoff);
  return (
    <Modal title={t.id ? `Edit ${t.name}` : "Add leave type"} onClose={onClose}>
      <form
        className="grid gap-3"
        action={async (f) => {
          const g = (k: string) => String(f.get(k) ?? "");
          const on = (k: string) => f.get(k) === "on";
          const r = await act(() =>
            saveLeaveTypeAction({
              id: t.id,
              name: g("name"),
              color: g("color"),
              daysPerYear: Number(g("days") || 0),
              accrualType: g("accrual") === "monthly" ? "monthly" : "full_year",
              carryForwardCap: Number(g("carry") || 0),
              maxConsecutiveDays: g("maxc") ? Number(g("maxc")) : null,
              noticePeriodDays: Number(g("notice") || 0),
              allowHalfDay: on("half"),
              halfDayFirst: on("h1"),
              halfDaySecond: on("h2"),
              requiresDocumentAfterDays: g("doc") ? Number(g("doc")) : null,
              requiresReason: on("reason"),
              availableTo: g("avail"),
              countWeekends: on("weekends"),
              isCompoff: compoff,
              isActive: on("active"),
              sortOrder: Number(g("order") || 0),
            }),
          );
          if (r.ok) onClose();
        }}
      >
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label="Name">
            <input name="name" className="input" defaultValue={t.name ?? ""} required maxLength={60} />
          </Field>
          <Field label="Colour">
            <select name="color" className="input" defaultValue={t.color ?? "blue"}>
              {LEAVE_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={compoff} onChange={(e) => setCompoff(e.target.checked)} /> Comp-off (spends earned comp-offs; no yearly days)
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {!compoff && (
            <>
              <Field label="Days per year">
                <input name="days" type="number" step="0.5" min={0} max={365} className="input" defaultValue={t.daysPerYear ?? 12} />
              </Field>
              <Field label="Accrual">
                <select name="accrual" className="input" defaultValue={t.accrualType ?? "full_year"}>
                  <option value="full_year">All at once (1 Jan)</option>
                  <option value="monthly">Monthly</option>
                </select>
              </Field>
              <Field label="Carry forward cap">
                <input name="carry" type="number" step="0.5" min={0} max={365} className="input" defaultValue={t.carryForwardCap ?? 0} />
              </Field>
            </>
          )}
          <Field label="Notice (days)">
            <input name="notice" type="number" min={0} max={365} className="input" defaultValue={t.noticePeriodDays ?? 0} />
          </Field>
          <Field label="Max days in a row">
            <input name="maxc" type="number" min={1} max={365} className="input" defaultValue={t.maxConsecutiveDays ?? ""} placeholder="No limit" />
          </Field>
          <Field label="Document after (days)">
            <input name="doc" type="number" min={0} max={365} className="input" defaultValue={t.requiresDocumentAfterDays ?? ""} placeholder="Never" />
          </Field>
          <Field label="Available to">
            <select name="avail" className="input" defaultValue={t.availableTo ?? "all"}>
              <option value="all">Everyone</option>
              {EMPLOYMENT_TYPES.map((e) => (
                <option key={e} value={e}>
                  {EMPLOYMENT_LABEL[e]} only
                </option>
              ))}
            </select>
          </Field>
          <Field label="Order">
            <input name="order" type="number" min={0} max={999} className="input" defaultValue={t.sortOrder ?? 0} />
          </Field>
        </div>
        <div className="grid gap-1.5 text-sm sm:grid-cols-2">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="half" defaultChecked={!!t.allowHalfDay} /> Half days allowed
          </label>
          <span className="inline-flex gap-4">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="h1" defaultChecked={t.halfDayFirst ?? true} /> First half
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="h2" defaultChecked={t.halfDaySecond ?? true} /> Second half
            </label>
          </span>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="reason" defaultChecked={!!t.requiresReason} /> Reason required
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="weekends" defaultChecked={!!t.countWeekends} /> Count weekly offs and holidays
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={t.isActive ?? true} /> Offered (switch off to hide it)
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Holidays({ holidays, year }: { holidays: Holiday[]; year: number }) {
  const { act, pending } = useAct();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [optional, setOptional] = useState(false);
  return (
    <Card
      title={`Holidays ${year}`}
      actions={
        <span className="inline-flex gap-1">
          {[year - 1, year + 1].map((y) => (
            <a key={y} href={`/attendance/admin/settings?year=${y}`} className="att-badge att-tone-neutral">
              {y}
            </a>
          ))}
        </span>
      }
      pad={false}
    >
      <form
        className="grid gap-2 border-b border-[var(--att-line)] px-5 py-4 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => saveHolidayAction({ date, name, isOptional: optional }));
          if (r.ok) {
            setDate("");
            setName("");
            setOptional(false);
          }
        }}
      >
        <Field label="Date">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Name">
          <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <label className="inline-flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> Optional
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Add
        </button>
      </form>
      {holidays.length === 0 ? (
        <p className="px-5 py-4 text-sm att-muted">No holidays for {year} yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--att-line)]">
          {holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
              <span className="w-24 shrink-0 font-semibold">{formatDayShort(h.date)}</span>
              <span className="min-w-[8rem] flex-1">{h.name}</span>
              <button
                type="button"
                className={`att-badge ${h.isOptional ? "att-tone-amber" : "att-tone-neutral"}`}
                disabled={pending}
                title="Optional holidays are working days people may take as leave"
                onClick={() => act(() => saveHolidayAction({ id: h.id, date: h.date, name: h.name, isOptional: !h.isOptional }))}
              >
                {h.isOptional ? "Optional" : "Mark optional"}
              </button>
              <button type="button" aria-label={`Remove ${h.name}`} className="att-muted hover:text-[var(--att-red)]" disabled={pending} onClick={() => act(() => deleteHolidayAction(h.id))}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StorageCheck() {
  const { act, pending } = useAct();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <Card title="Document storage" icon={HardDrive} iconTone="grey">
      <p className="text-sm att-muted">Leave documents (sick notes) are kept in the private Supabase Storage bucket “attendance-files”.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={pending}
          onClick={async () => {
            const r = await act(checkStorageAction, { quiet: true, noRefresh: true });
            if (r.ok) setMsg(r.data);
          }}
        >
          Check storage
        </button>
        {msg && <span className={`text-sm font-semibold ${msg.ok ? "text-[var(--att-green-dark)]" : "text-[var(--att-red)]"}`}>{msg.message}</span>}
      </div>
    </Card>
  );
}
