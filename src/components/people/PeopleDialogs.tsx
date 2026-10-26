"use client";

import { RoleOptions, type RoleHolder } from "@/components/people/RoleOptions";
import { useEffect, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, Copy, KeyRound, Mail, RefreshCw } from "lucide-react";
import { AccessTree } from "@/components/AccessTree";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { addPerson, assignApps, previewAssignment, selectionStatus, sendSetupLink, setPersonPassword, type AddResult, type AssignTarget, type LinkResult, type SelectionStatus } from "@/actions/people";
import type { AccessResult } from "@/lib/access-ops";
import type { CatalogApp, CatalogDept } from "@/lib/catalog";
import { generatePassword } from "@/lib/generate-password";

export type Option = { id: string; name: string };
export type Manager = { id: string; name: string; email: string };
export type Catalog = { departments: CatalogDept[]; apps: CatalogApp[] };
export type Template = { id: string; name: string; appIds: string[] };

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block"><span className="label-xs mb-1.5 block">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}</label>
);

/** Shows one-time setup links that could not be emailed, so the administrator can pass them on. They exist only on this screen. */
export function LinksDialog({ results, onClose }: { results: LinkResult[]; onClose: () => void }) {
  const toast = useToast();
  const withLink = results.filter((r) => r.link);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied.`); } catch { toast.error("Could not copy. Select the link and copy it by hand."); }
  };
  return (
    <Modal title="Setup links" onClose={onClose}>
      <div className="space-y-4">
        <div className="alert alert-green"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{results.filter((r) => r.ok && r.delivery === "sent").length} emailed, {withLink.length} to pass on by hand, {results.filter((r) => !r.ok).length} could not be made.</span></div>
        {withLink.length > 0 && (
          <div className="alert"><AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>These links are shown only now and are not stored anywhere. Each one lets its owner choose a password, works once and expires in 72 hours. Send each only to the person it is for.</span></div>
        )}
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {results.map((r) => (
            <li key={r.id} className="space-y-1.5 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><b>{r.name || "Unknown"}</b><span className="text-xs text-muted">{r.email}</span>
                <span className={`badge ${r.ok ? (r.delivery === "sent" ? "badge-green" : "badge-purple") : "badge-red"}`}>{r.ok ? (r.delivery === "sent" ? "Emailed" : "Pass on by hand") : "Not made"}</span></div>
              <p className="text-xs text-muted">{r.message}</p>
              {r.link && (
                <div className="flex gap-2"><input readOnly className="input !py-1.5 font-mono text-xs" value={r.link} aria-label={`Setup link for ${r.name}`} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => copy(r.link!, "Link")}><Copy size={14} /> Copy</button></div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          {withLink.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(withLink.map((r) => `${r.name} <${r.email}>: ${r.link}`).join("\n"), "All links")}><Copy size={14} /> Copy all</button>}
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

/** Reset someone's access to the hub: send them a setup link (best), or type a password for someone who cannot receive email. */
export function ResetDialog({ person, onClose, onLinks }: { person: { id: string; name: string }; onClose: () => void; onLinks: (r: LinkResult[]) => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pw, setPw] = useState(() => generatePassword());
  return (
    <Modal title={`Reset password for ${person.name}`} onClose={onClose}>
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-base">Send a setup link (recommended)</h3>
          <p className="text-sm text-muted">They get a one-time link and choose their own password. Nobody else ever sees it. Any older link stops working.</p>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => {
            const r = await sendSetupLink(person.id);
            if (!r.ok) return toast.error(r.error);
            if (r.data.ok && r.data.delivery === "sent") { toast.success(`Setup link emailed to ${r.data.email}.`); onClose(); } else { onLinks([r.data]); onClose(); }
          })}><Mail size={14} /> Send setup link</button>
        </section>
        <form className="space-y-3 border-t border-line pt-5" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await setPersonPassword(person.id, pw);
            if (r.ok) { toast.success("Password reset. They are signed out and need the new one."); toast.success("Share the new password with them."); onClose(); } else toast.error(r.error);
          });
        }}>
          <h3 className="text-base">Or set a password for them</h3>
          <p className="text-sm text-muted">Only for someone who cannot receive email. The password is hashed at once and is not recorded anywhere, including the audit log.</p>
          <label className="block"><span className="label-xs mb-1.5 block">New password</span>
            <div className="flex gap-2">
              <input className="input font-mono" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} maxLength={128} autoComplete="off" />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setPw(generatePassword())}><RefreshCw size={14} /> Generate</button>
            </div>
            <span className="mt-1 block text-xs text-subtle">At least 10 characters with a letter and a number.</span></label>
          <button className="btn btn-ghost btn-sm" disabled={pending}><KeyRound size={14} /> Reset password</button>
        </form>
      </div>
    </Modal>
  );
}

/** Add one person. By default they receive a setup link; setting a password by hand is the exception. */
export function AddPersonDialog({ options, catalog, domains, canPromote, onClose, onDone }: {
  options: { branches: Option[]; teams: Option[]; managers: Manager[]; roleHolders?: RoleHolder[] }; catalog: Catalog; domains: string;
  /** Only the Support Admin may add someone as an Admin or a Super Admin. */
  canPromote: boolean;
  onClose: () => void; onDone: (r: AddResult & { name: string; email: string }) => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ name: "", email: "", designation: "", role: "member" as string, branchId: "", teamId: "", managerId: "" });
  const [appIds, setAppIds] = useState<string[]>([]);
  const [byHand, setByHand] = useState(false);
  const [password, setPassword] = useState(() => generatePassword());
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <Modal title="Add user" onClose={onClose}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await addPerson({
            ...v, branchId: v.branchId || null, teamId: v.teamId || null, managerId: v.managerId || null,
            appIds, password: byHand ? password : "", invite: true,
          });
          if (r.ok) onDone({ ...r.data, name: v.name, email: v.email.trim().toLowerCase() });
          else { setError(r.error); toast.error(r.error); }
        });
      }}>
        {error && <div role="alert" className="alert alert-red sm:col-span-2"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
        <Field label="Name"><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} /></Field>
        <Field label="Email (the username)"><input className="input" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} required placeholder={domains ? `name${domains.split(" or ")[0]}` : "name@example.com"} /></Field>
        <Field label="Designation (optional)"><input className="input" value={v.designation} onChange={(e) => set("designation", e.target.value)} maxLength={120} /></Field>
        <Field label="Role">
          <select className="input" value={v.role} onChange={(e) => set("role", e.target.value)}><RoleOptions holders={options.roleHolders ?? []} personId={null} canPromote={canPromote} current={v.role} /></select></Field>
        <Field label="Branch (optional)"><select className="input" value={v.branchId} onChange={(e) => set("branchId", e.target.value)}><option value="">None</option>{options.branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Team (optional)"><select className="input" value={v.teamId} onChange={(e) => set("teamId", e.target.value)}><option value="">None</option>{options.teams.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Reporting manager (optional)"><select className="input" value={v.managerId} onChange={(e) => set("managerId", e.target.value)}><option value="">None</option>{options.managers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.email})</option>)}</select></Field>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="label-xs mb-1.5">How do they get their password?</legend>
          <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1 accent-[var(--c-primary)]" checked={!byHand} onChange={() => setByHand(false)} />
            <span><b>Send them a setup link</b> (recommended). They choose their own password. If no email is set up, you will get the link to pass on.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1 accent-[var(--c-primary)]" checked={byHand} onChange={() => setByHand(true)} />
            <span><b>I will set a password for them</b>, for someone who cannot receive email.</span></label>
          {byHand && (
            <div className="flex gap-2 pl-6">
              <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={128} autoComplete="off" aria-label="Password" />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setPassword(generatePassword())}><RefreshCw size={14} /> Generate</button>
            </div>
          )}
        </fieldset>

        <details className="rounded-md border border-line p-3 sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium">Applications (optional) · {appIds.length} chosen</summary>
          <div className="mt-3"><AccessTree departments={catalog.departments} apps={catalog.apps} value={appIds} onChange={setAppIds} disabled={pending} /></div>
        </details>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={pending}>Create user</button></div>
      </form>
    </Modal>
  );
}

type Source = "selected" | "team" | "branch";

/** Give or take away applications for chosen people, or for a whole team or branch: choose, review, confirm, result. */
export function AssignDialog({ selection, options, catalog, templates, onClose, onDone }: {
  selection: { ids: string[]; allMatching: boolean; filterQuery: string; count: number };
  options: { branches: Option[]; teams: Option[] }; catalog: Catalog; templates: Template[];
  onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [source, setSource] = useState<Source>(selection.count > 0 ? "selected" : "team");
  const [groupId, setGroupId] = useState("");
  const [appIds, setAppIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"add" | "remove" | "replace">("add");
  const [tpl, setTpl] = useState("");
  const [status, setStatus] = useState<SelectionStatus | null>(null);
  const [preview, setPreview] = useState<{ rows: { userId: string; name: string; email: string; willAdd: { name: string }[]; willRemove: { name: string }[] }[]; adds: number; removes: number; unchanged: number } | null>(null);
  const [result, setResult] = useState<AccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const target = (): AssignTarget =>
    source === "selected" ? { ids: selection.allMatching ? [] : selection.ids, filterQuery: selection.allMatching ? selection.filterQuery : undefined }
    : source === "team" ? { teamId: groupId } : { branchId: groupId };
  const ready = source === "selected" ? selection.count > 0 : !!groupId;

  // How many of the chosen people already have each application.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void selectionStatus(target()).then((r) => { if (live) { setStatus(r.ok ? r.data : null); if (!r.ok) setError(r.error); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, groupId, ready]);

  const groups = source === "team" ? options.teams : options.branches;
  const shownStatus = ready ? status : null;
  const note = (id: string) => (shownStatus ? `${shownStatus.perApp[id] ?? 0} of ${shownStatus.people} have it` : null);
  const canReview = ready && (mode === "replace" || appIds.length > 0);
  const verb = mode === "add" ? "Add" : mode === "remove" ? "Remove" : "Replace";

  const review = () => start(async () => {
    setError(null);
    const r = await previewAssignment({ ...target(), appIds, mode });
    if (r.ok) { setPreview(r.data); setStep(2); } else setError(r.error);
  });
  const confirm = () => start(async () => {
    setError(null);
    const r = await assignApps({ ...target(), appIds, mode });
    if (r.ok) { setResult(r.data); setStep(3); } else setError(`${r.error} Nothing was changed.`);
  });

  return (
    <Modal title="Assign applications" onClose={step === 3 ? onDone : onClose}>
      <div className="space-y-5">
        <ol className="flex gap-2 text-xs font-semibold text-subtle" aria-label="Steps">
          {["1 Choose", "2 Review", "3 Done"].map((l, i) => <li key={l} className={`rounded-pill px-3 py-1 ${step === i + 1 ? "bg-nav-active text-primary" : "bg-alt"}`}>{l}</li>)}
        </ol>
        {error && <div role="alert" className="alert alert-red"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

        {step === 1 && (
          <div className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="label-xs mb-1.5">Who</legend>
              {selection.count > 0 && (
                <label className="flex items-center gap-2 text-sm"><input type="radio" className="accent-[var(--c-primary)]" checked={source === "selected"} onChange={() => { setSource("selected"); setGroupId(""); }} />
                  The {selection.count} {selection.allMatching ? "people matching the current filters" : selection.count === 1 ? "person selected" : "people selected"}</label>
              )}
              {(["team", "branch"] as const).map((s) => (
                <label key={s} className="flex flex-wrap items-center gap-2 text-sm"><input type="radio" className="accent-[var(--c-primary)]" checked={source === s} onChange={() => { setSource(s); setGroupId(""); }} />
                  Everyone in a {s}
                  {source === s && (
                    <select className="input !w-auto min-w-48 !py-1.5" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label={`Choose a ${s}`}>
                      <option value="">Choose a {s}…</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}</label>
              ))}
              {shownStatus && <p className="text-xs text-muted">{shownStatus.people} {shownStatus.people === 1 ? "person" : "people"}: {shownStatus.names.join(", ")}{shownStatus.people > shownStatus.names.length ? ` and ${shownStatus.people - shownStatus.names.length} more` : ""}</p>}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="label-xs mb-1.5">What to do</legend>
              {([["add", "Add these applications to what they already have"], ["remove", "Remove these applications from what they have"], ["replace", "Make their access exactly these applications (anything else is removed)"]] as const).map(([m, label]) => (
                <label key={m} className="flex items-center gap-2 text-sm"><input type="radio" className="accent-[var(--c-primary)]" checked={mode === m} onChange={() => setMode(m)} />{label}</label>
              ))}
            </fieldset>

            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <span className="label-xs">Applications · {appIds.length} chosen</span>
                {templates.length > 0 && (
                  <select className="input !w-auto min-w-44 !py-1.5" value={tpl} aria-label="Start from a template" onChange={(e) => { setTpl(e.target.value); const t = templates.find((x) => x.id === e.target.value); if (t) setAppIds(t.appIds.filter((id) => catalog.apps.some((a) => a.id === id))); }}>
                    <option value="">Start from a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.appIds.length})</option>)}
                  </select>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto pr-1"><AccessTree departments={catalog.departments} apps={catalog.apps} value={appIds} onChange={setAppIds} disabled={pending} note={note} /></div>
            </div>
            <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={pending || !canReview} onClick={review}>Review changes</button></div>
          </div>
        )}

        {step === 2 && preview && (
          <div className="space-y-4">
            <p className="text-sm">
              <b>{preview.rows.length - preview.unchanged}</b> of {preview.rows.length} {preview.rows.length === 1 ? "person" : "people"} will change: <b className="text-brand-green-text">{preview.adds} added</b>, <b className="text-brand-red">{preview.removes} removed</b>
              {preview.unchanged > 0 ? `, ${preview.unchanged} already as asked.` : "."}
            </p>
            <div className="table-wrap max-h-72 overflow-y-auto"><table>
              <thead><tr><th>Person</th><th>Gets</th><th>Loses</th></tr></thead>
              <tbody>{preview.rows.slice(0, 200).map((r) => (
                <tr key={r.userId}><td><b>{r.name}</b><span className="block text-xs text-muted">{r.email}</span></td>
                  <td>{r.willAdd.length ? r.willAdd.map((a) => a.name).join(", ") : <span className="text-subtle">—</span>}</td>
                  <td>{r.willRemove.length ? r.willRemove.map((a) => a.name).join(", ") : <span className="text-subtle">—</span>}</td></tr>
              ))}{preview.rows.length > 200 && <tr><td colSpan={3} className="text-subtle">…and {preview.rows.length - 200} more</td></tr>}</tbody>
            </table></div>
            {preview.adds + preview.removes === 0 && <div className="alert"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>Nothing to change: everyone already has this access.</span></div>}
            <p className="text-xs text-muted">The change is all-or-nothing: either everyone above is updated, or no one is.</p>
            <div className="flex justify-between gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(1)} disabled={pending}><ChevronLeft size={14} /> Back</button>
              <button type="button" className={`btn btn-sm ${mode === "add" ? "btn-primary" : "btn-danger"}`} disabled={pending || preview.adds + preview.removes === 0} onClick={confirm}>{verb} for {preview.rows.length - preview.unchanged} {preview.rows.length - preview.unchanged === 1 ? "person" : "people"}</button></div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-4">
            <div role="status" className="alert alert-green"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />
              <span>Saved. {result.changed.length} {result.changed.length === 1 ? "person" : "people"} changed{result.unchanged ? `, ${result.unchanged} already as asked` : ""}. Recorded in the audit log.</span></div>
            {result.changed.length > 0 && (
              <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line text-sm">
                {result.changed.slice(0, 100).map((c) => (
                  <li key={c.userId} className="px-4 py-2.5"><b>{c.name}</b>
                    {c.added.length > 0 && <span className="ml-2 text-brand-green-text">+ {c.added.map((a) => a.name).join(", ")}</span>}
                    {c.removed.length > 0 && <span className="ml-2 text-brand-red">− {c.removed.map((a) => a.name).join(", ")}</span>}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end"><button type="button" className="btn btn-primary btn-sm" onClick={onDone}>Done</button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
