"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMembershipAgent,
  connectSmartflo,
  disconnectSmartflo,
  refreshAgents,
  removeUnlinkedAgentsAction,
  saveAutoSyncAction,
  syncNow,
} from "@/lib/ivr/actions/admin";
import { Alert, Badge } from "@/components/ivr/ui";

type Flash = { ok: boolean; text: string } | null;

export function SmartfloPanel({
  mode,
  connected,
  status,
  lastSync,
  lastError,
  webhookUrl,
  mapped,
  totalAgents,
  autoSync,
  lastTick,
  cronUrl,
}: {
  mode: "live" | "mock";
  connected: boolean;
  status: string;
  lastSync: string | null;
  lastError: string | null;
  webhookUrl: string;
  mapped: number;
  totalAgents: number;
  autoSync: { enabled: boolean; startHour: number; endHour: number; minGapSec: number };
  lastTick: { text: string } | null;
  cronUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Flash>(null);
  const [useToken, setUseToken] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const [auto, setAuto] = useState(autoSync);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done") : (r.error ?? "Something went wrong") });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the URL is selectable text */
    }
  };

  const healthy = connected && status !== "error";

  return (
    <div className="ivr-card grid gap-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl">Tata Smartflo</h2>
          <p className="text-[13px] text-muted">
            One organisation connection feeds every agent. Calls are matched to agents through the mapping below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "mock" && <Badge color="var(--ivr-incoming)">Demo mode</Badge>}
          {healthy ? <Badge color="var(--ivr-done)">Connected</Badge> : connected ? <Badge color="var(--ivr-missed)">Needs attention</Badge> : <Badge color="var(--ivr-muted)">Not connected</Badge>}
        </div>
      </div>

      {mode === "mock" && (
        <p className="rounded-[12px] border border-dashed border-line px-4 py-3 text-[0.8rem] text-muted">
          <b>SMARTFLO_MODE=mock</b>: sample agents and calls are generated so you can try everything. Set <span className="font-mono">SMARTFLO_MODE=live</span>{" "}
          and connect real credentials below to use your account.
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="ivr-label">Last sync</dt>
          <dd className="font-semibold">{lastSync ?? "Never"}</dd>
        </div>
        <div>
          <dt className="ivr-label">Agents mapped</dt>
          <dd className="font-semibold tabular-nums">
            {mapped} of {totalAgents}
          </dd>
        </div>
        <div>
          <dt className="ivr-label">Last error</dt>
          <dd className={lastError ? "font-semibold text-brand-red" : "font-semibold"}>{lastError ?? "None"}</dd>
        </div>
      </dl>

      {mode === "live" && (
        <form
          className="grid gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => (useToken ? connectSmartflo({ token }) : connectSmartflo({ email, password })),
              () => {
                setPassword("");
                setToken("");
              },
            );
          }}
        >
          <h3 className="text-[0.95rem]">{connected ? "Update credentials" : "Connect your Smartflo account"}</h3>
          <div className="flex gap-4 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!useToken} onChange={() => setUseToken(false)} /> Account login
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={useToken} onChange={() => setUseToken(true)} /> API token
            </label>
          </div>
          {useToken ? (
            <label className="grid max-w-md gap-1 ivr-label">
              API token (Smartflo → API Connect)
              <input className="input font-normal text-ink" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
          ) : (
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <label className="grid gap-1 ivr-label">
                Smartflo login email
                <input className="input font-normal text-ink" type="text" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="grid gap-1 ivr-label">
                Password
                <input className="input font-normal text-ink" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            </div>
          )}
          <p className="text-[12px] text-muted">We test the login first and store it encrypted. An API token expires, so the account login is the better choice.</p>
          <div>
            <button className="btn btn-primary" disabled={pending || (useToken ? token.length < 10 : !email || !password)}>
              {pending ? "Testing…" : "Test and save"}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button className="btn btn-primary" disabled={pending || (!connected && mode === "live")} onClick={() => run(() => syncNow(48))}>
          Sync now (last 2 days)
        </button>
        <button className="btn btn-ghost" disabled={pending || (!connected && mode === "live")} onClick={() => run(() => syncNow(24 * 30))}>
          Backfill 30 days
        </button>
        {connected && mode === "live" && (
          <button className="btn btn-danger ml-auto" disabled={pending} onClick={() => run(() => disconnectSmartflo())}>
            Disconnect
          </button>
        )}
      </div>

      <section className="grid gap-3 border-t border-line pt-4">
        <h3 className="text-[0.95rem]">Automatic sync</h3>
        <p className="text-[13px] text-muted">
          Calls are fetched on their own: every open browser tab asks for new calls about once a minute (the server runs one sync for all tabs) and
          the page updates by itself. Webhooks below make a finished call appear within seconds. You only need the buttons above to backfill.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveAutoSyncAction(auto));
          }}
        >
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={auto.enabled} onChange={(e) => setAuto({ ...auto, enabled: e.target.checked })} /> Sync automatically
          </label>
          <label className="grid gap-1 ivr-label">
            From (IST hour)
            <input className="input w-20 font-normal text-ink" type="number" min={0} max={23} value={auto.startHour} onChange={(e) => setAuto({ ...auto, startHour: Number(e.target.value) })} />
          </label>
          <label className="grid gap-1 ivr-label">
            Until (IST hour)
            <input className="input w-20 font-normal text-ink" type="number" min={1} max={24} value={auto.endHour} onChange={(e) => setAuto({ ...auto, endHour: Number(e.target.value) })} />
          </label>
          <label className="grid gap-1 ivr-label">
            At most every (seconds)
            <input className="input w-24 font-normal text-ink" type="number" min={30} max={3600} value={auto.minGapSec} onChange={(e) => setAuto({ ...auto, minGapSec: Number(e.target.value) })} />
          </label>
          <button className="btn btn-ghost" disabled={pending}>
            Save
          </button>
        </form>
        <p className="text-[12px] text-muted">
          Last automatic run: {lastTick?.text ?? "none yet"}. Outside these hours nothing is fetched, which lets the Neon database sleep; the daily
          sync still catches up. To also sync when nobody has the app open, point a free scheduler (for example cron-job.org, every 5 minutes) at{" "}
          <span className="font-mono break-all">{cronUrl}</span> with the header <span className="font-mono">Authorization: Bearer &lt;CRON_SECRET&gt;</span>.
        </p>
      </section>

      <section className="grid gap-3 border-t border-line pt-4">
        <h3 className="text-[0.95rem]">Membership agents</h3>
        <p className="text-[13px] text-muted">
          The Smartflo account is shared, so only Membership agents are kept: those that match an IVR-CRM agent, and any you add here. Other agents are
          ignored and are not stored, and the daily sync does not re-read the agent list.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addMembershipAgent(agentQuery), () => setAgentQuery(""));
          }}
        >
          <label className="grid gap-1 ivr-label">
            Add an agent (phone, extension or full name)
            <input className="input w-72 font-normal text-ink" value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} />
          </label>
          <button className="btn btn-ghost" disabled={pending || (!connected && mode === "live") || agentQuery.trim().length < 3}>
            Add agent
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending || (!connected && mode === "live")} onClick={() => run(() => refreshAgents())}>
            Refresh kept agents
          </button>
          {totalAgents > mapped && (
            <button
              type="button"
              className="btn btn-ghost ml-auto"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Remove the ${totalAgents - mapped} stored agents that are not linked to an IVR-CRM agent? Calls and members are not affected.`)) {
                  run(() => removeUnlinkedAgentsAction());
                }
              }}
            >
              Remove {totalAgents - mapped} unlinked
            </button>
          )}
        </form>
      </section>

      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </Alert>
      )}

      <section className="grid gap-2 border-t border-line pt-4">
        <h3 className="text-[0.95rem]">Live updates (webhook)</h3>
        <p className="text-[13px] text-muted">
          Ask Tata support to enable webhooks, then in Smartflo go to API Connect → Webhook → Add Webhook. Create one webhook per trigger below, all
          pointing to this URL, with <b>POST</b>, <b>application/json</b>, date format <b>ISO 8601</b> and time zone <b>IST</b>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-[12px] border border-line bg-alt px-3.5 py-2.5 font-mono text-[12px] break-all select-all">{webhookUrl}</code>
          <button className="btn btn-ghost btn-sm" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[12px] text-muted">
          Triggers: <i>Call answered by Agent</i>, <i>Call hangup (Missed or Answered)</i>, and for click-to-call <i>Call answered by Customer</i>. The URL
          contains a secret because Smartflo does not sign webhooks, so keep it private. A scheduled sync repairs anything a webhook misses.
        </p>
      </section>
    </div>
  );
}
