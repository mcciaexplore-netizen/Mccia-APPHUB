"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mapAgent, saveAgentProfile } from "@/lib/ivr/actions/admin";
import { Alert, Empty } from "@/components/ivr/ui";

export type AgentRowDTO = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  softphoneExtension: string | null;
  agentId: string | null;
  open: number;
};
export type AgentOpt = { id: string; label: string; takenBy: string | null };

/**
 * The agents (everyone given the IVR-CRM application in the hub) with what IVR-CRM keeps about them: the phone Smartflo rings, their
 * browser softphone extension and their Smartflo agent. Adding or removing an agent is done in the hub, by giving or taking away the
 * application.
 */
export function AgentsManager({ agents, smartflo }: { agents: AgentRowDTO[]; smartflo: AgentOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState({ phone: "", softphoneExtension: "" });

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : (r.error ?? "Something went wrong") });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  if (!agents.length) {
    return (
      <div className="ivr-card">
        <Empty title="No agents yet">Give the IVR-CRM application to the Membership team in Administrator → Applications. They appear here.</Empty>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </Alert>
      )}
      <div className="ivr-card overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="ivr-th">Agent</th>
              <th className="ivr-th">Phone Smartflo rings</th>
              <th className="ivr-th">Softphone extension</th>
              <th className="ivr-th">Smartflo agent</th>
              <th className="ivr-th text-right">Open members</th>
              <th className="ivr-th" />
            </tr>
          </thead>
          <tbody>
            {agents.map((u) => {
              const editing = edit === u.id;
              return (
                <tr key={u.id} className="align-top" data-agent-row={u.id}>
                  <td className="ivr-td">
                    <span className="font-semibold">{u.name}</span>
                    <span className="block text-[12px] text-muted">{u.email}</span>
                  </td>
                  <td className="ivr-td">
                    {editing ? (
                      <input className="input" aria-label={`Phone for ${u.name}`} placeholder="+91 98765 43210" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                    ) : (
                      <span className="font-mono">{u.phone ?? "–"}</span>
                    )}
                  </td>
                  <td className="ivr-td">
                    {editing ? (
                      <input
                        className="input font-mono"
                        inputMode="numeric"
                        aria-label={`Softphone extension for ${u.name}`}
                        placeholder="060123456"
                        value={draft.softphoneExtension}
                        onChange={(e) => setDraft({ ...draft, softphoneExtension: e.target.value })}
                      />
                    ) : (
                      <span className="font-mono">{u.softphoneExtension ?? "–"}</span>
                    )}
                  </td>
                  <td className="ivr-td">
                    <select
                      className="input w-auto max-w-[240px]"
                      aria-label={`Smartflo agent for ${u.name}`}
                      value={u.agentId ?? ""}
                      disabled={pending || smartflo.length === 0}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id) run(() => mapAgent(id, u.id));
                        else if (u.agentId) run(() => mapAgent(u.agentId!, null));
                      }}
                    >
                      <option value="">{smartflo.length ? "Not linked" : "No Smartflo agents synced yet"}</option>
                      {smartflo.map((a) => (
                        <option key={a.id} value={a.id} disabled={!!a.takenBy && a.id !== u.agentId}>
                          {a.label}
                          {a.takenBy && a.id !== u.agentId ? ` (used by ${a.takenBy})` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="ivr-td text-right tabular-nums">{u.open}</td>
                  <td className="ivr-td whitespace-nowrap text-right">
                    {editing ? (
                      <span className="flex justify-end gap-2">
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={pending}
                          onClick={() => run(() => saveAgentProfile(u.id, { phone: draft.phone || undefined, softphoneExtension: draft.softphoneExtension }), () => setEdit(null))}
                        >
                          Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEdit(u.id);
                          setDraft({ phone: u.phone ?? "", softphoneExtension: u.softphoneExtension ?? "" });
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
