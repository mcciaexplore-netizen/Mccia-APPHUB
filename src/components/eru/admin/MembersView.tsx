"use client";

import { useEffect, useState } from "react";
import { Search, UserMinus, UserPlus } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { removeMemberAction, searchUsersAction, setMemberRoleAction } from "@/lib/eru/actions/admin";
import { Avatar, Card, Empty } from "../ui";
import { useAct } from "../use-act";

type Member = { id: string; name: string; email: string; designation: string | null; role: "admin" | "member" };
type Person = { id: string; name: string; email: string };

/**
 * The ERU team. Adding someone makes them App Staff of ERU (a member) and gives them ERU; making them an admin moves them to ERU's App Admins
 * and gives them ERU Admin as well; removing takes both lists and both applications away. These are the hub's own lists, so Administrator
 * shows the same people.
 */
export function MembersView({ members, meId, appsReady }: { members: Member[]; meId: string; appsReady: { user: boolean; admin: boolean } }) {
  const { act, pending } = useAct();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [role, setRole] = useState<"member" | "admin">("member");
  const ids = new Set(members.map((m) => m.id));
  const results = q.trim().length >= 2 ? found : [];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      const r = await searchUsersAction(term);
      if (r.ok) setFound(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-col gap-5">
      {!appsReady.user && (
        <p role="alert" className="rounded-xl border border-[rgba(217,119,6,0.3)] bg-[var(--eru-amber-tint)] px-4 py-3 text-sm text-[#92400e]">
          The ERU application (URL /eru) is not in Administrator → Applications yet, so nobody can be added. The Support Admin adds it there first.
        </p>
      )}
      {appsReady.user && !appsReady.admin && (
        <p className="rounded-xl border border-[var(--eru-line)] bg-white px-4 py-3 text-sm eru-muted">
          ERU Admin (URL /eru/admin) is not in Administrator → Applications yet: admins can still open it from the ERU menu, but its tile will not show on their hub.
        </p>
      )}
      <Card title="Add a member">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs font-semibold eru-muted">
            Search hub users by name or email
            <span className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 eru-muted" aria-hidden />
              <input className="input w-full pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="At least 2 letters" disabled={!appsReady.user} />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
            As
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--eru-line)] rounded-lg border border-[var(--eru-line)]">
            {results.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={p.name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{p.name}</span>
                  <span className="block truncate text-xs eru-muted">{p.email}</span>
                </span>
                {ids.has(p.id) ? (
                  <span className="text-xs eru-muted">Already in the team</span>
                ) : (
                  <button
                    type="button"
                    className="btn eru-btn-navy btn-sm"
                    disabled={pending}
                    onClick={async () => {
                      const r = await act(() => setMemberRoleAction(p.id, role), { quiet: true });
                      if (r.ok) {
                        setQ("");
                        setFound([]);
                      }
                    }}
                  >
                    <UserPlus size={13} aria-hidden /> Add as {role}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Team (${members.length})`} pad={false}>
        {members.length ? (
          <ul className="divide-y divide-[var(--eru-line)]">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="eru-member-row">
                <Avatar name={m.name} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">
                    {m.name}
                    {m.id === meId && <span className="ml-1 text-xs font-normal eru-muted">(you)</span>}
                  </span>
                  <span className="block truncate text-xs eru-muted">
                    {m.email}
                    {m.designation ? ` · ${m.designation}` : ""}
                  </span>
                </span>
                <select
                  className="input py-1.5 text-sm"
                  aria-label={`Role of ${m.name}`}
                  value={m.role}
                  disabled={pending || m.id === meId}
                  onChange={(e) => act(() => setMemberRoleAction(m.id, e.target.value as "member" | "admin"), { quiet: true })}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={pending || m.id === meId}
                  onClick={async () => {
                    if (await confirm({ title: `Remove ${m.name} from ERU?`, message: "They lose ERU (and ERU Admin). Their projects, documents and comments stay.", confirmLabel: "Remove", danger: true }))
                      await act(() => removeMemberAction(m.id), { quiet: true });
                  }}
                >
                  <UserMinus size={13} aria-hidden /> Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nobody in the team yet">Search for hub users above to add them.</Empty>
        )}
      </Card>
    </div>
  );
}
