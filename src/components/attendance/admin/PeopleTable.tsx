"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { updatePersonAction } from "@/lib/attendance/actions/admin";
import { EMPLOYMENT_LABEL, EMPLOYMENT_TYPES } from "@/lib/attendance/att.manifest";
import { formatDay } from "@/lib/attendance/time";
import { Badge, Empty, Field } from "../ui";
import { useAct } from "../use-act";

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  teamName: string | null;
  managerId: string | null;
  managerName: string | null;
  shiftId: string | null;
  shiftName: string;
  employmentType: (typeof EMPLOYMENT_TYPES)[number];
  dateOfJoining: string | null;
  dateOfBirth: string | null;
};

/** Everyone in Attendance with their shift, manager and employment type; Edit changes them (the manager is the hub's own field). */
export function PeopleTable({ people, shifts }: { people: PersonRow[]; shifts: { id: string; name: string; isDefault: boolean }[] }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? people.filter((p) => `${p.name} ${p.email} ${p.teamName ?? ""} ${p.managerName ?? ""}`.toLowerCase().includes(t)) : people;
  }, [q, people]);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--att-line)] px-5 py-3">
        <input className="input w-full sm:max-w-xs" type="search" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <span className="text-xs att-muted">
          {shown.length} of {people.length} · {people.filter((p) => !p.managerId).length} without a manager (their requests go to HR)
        </span>
      </div>
      {shown.length === 0 ? (
        <Empty title="Nobody found" />
      ) : (
        <>
        <ul className="divide-y divide-[var(--att-line)] md:hidden">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-3 px-5 py-3.5 text-left" onClick={() => setEditing(p)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-gray-900">{p.name}</span>
                  <span className="block truncate text-xs text-gray-500">{[p.designation, p.teamName].filter(Boolean).join(" · ") || p.email}</span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {p.managerName ? `Reports to ${p.managerName}` : "No manager: requests go to HR"} · {p.shiftName} · {EMPLOYMENT_LABEL[p.employmentType]}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-[var(--att-primary-2)]">Edit</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="att-scroll hidden md:block">
          <table className="att-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Reporting manager</th>
                <th>Shift</th>
                <th>Type</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs att-muted">{[p.designation, p.teamName].filter(Boolean).join(" · ") || p.email}</p>
                  </td>
                  <td>{p.managerName ?? <Badge tone="amber">None: HR</Badge>}</td>
                  <td>{p.shiftName}</td>
                  <td>{EMPLOYMENT_LABEL[p.employmentType]}</td>
                  <td className="whitespace-nowrap text-xs">{p.dateOfJoining ? formatDay(p.dateOfJoining) : "—"}</td>
                  <td className="text-right">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      {editing && <EditPerson person={editing} people={people} shifts={shifts} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditPerson({ person, people, shifts, onClose }: { person: PersonRow; people: PersonRow[]; shifts: { id: string; name: string; isDefault: boolean }[]; onClose: () => void }) {
  const { act, pending } = useAct();
  return (
    <Modal title={`Edit ${person.name}`} onClose={onClose}>
      <form
        className="grid gap-3"
        action={async (f) => {
          const r = await act(() =>
            updatePersonAction(person.id, {
              managerId: String(f.get("managerId") ?? "") || null,
              shiftId: String(f.get("shiftId") ?? "") || null,
              employmentType: String(f.get("employmentType") ?? "staff"),
              dateOfJoining: String(f.get("doj") ?? "") || null,
              dateOfBirth: String(f.get("dob") ?? "") || null,
            }),
          );
          if (r.ok) onClose();
        }}
      >
        <Field label="Reporting manager" hint="Requests go to this person. With none, they go to HR. This is the hub's own manager field.">
          <select name="managerId" className="input" defaultValue={person.managerId ?? ""}>
            <option value="">None (requests go to HR)</option>
            {people
              .filter((p) => p.id !== person.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Shift">
          <select name="shiftId" className="input" defaultValue={person.shiftId ?? ""}>
            <option value="">Default shift ({shifts.find((s) => s.isDefault)?.name ?? "General"})</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employment type">
          <select name="employmentType" className="input" defaultValue={person.employmentType}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of joining">
            <input type="date" name="doj" className="input" defaultValue={person.dateOfJoining ?? ""} />
          </Field>
          <Field label="Date of birth">
            <input type="date" name="dob" className="input" defaultValue={person.dateOfBirth ?? ""} />
          </Field>
        </div>
        <div className="mt-2 flex justify-end gap-2">
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
