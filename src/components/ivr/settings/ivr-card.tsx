"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkMyAgentByPhone, removeClickToCallKey, saveClickToCallKey, saveMySoftphone } from "@/lib/ivr/actions/connections";
import { Phone } from "lucide-react";
import { Alert, Badge } from "@/components/ivr/ui";

type Msg = { ok: boolean; text: string } | null;

export function IvrCard({
  linkedAgent,
  hasKey,
  softphoneExtension,
  detectedExtension,
  mode,
}: {
  linkedAgent: { name: string; number: string | null; extension: string | null } | null;
  hasKey: boolean;
  softphoneExtension: string;
  detectedExtension: string | null;
  mode: "live" | "mock";
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [key, setKey] = useState("");
  const [ext, setExt] = useState(softphoneExtension);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : (r.error ?? "Something went wrong") });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="ivr-card card-lift grid gap-5 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="ivr-icon-tile">
            <Phone />
          </span>
          <div>
            <h2 className="text-xl">Tata Smartflo (IVR)</h2>
            <p className="text-[0.85rem] text-muted">Powers the Call button and brings your calls and recordings into the CRM.</p>
          </div>
        </div>
        {linkedAgent ? <Badge color="var(--ivr-done)">Connected</Badge> : <Badge color="var(--ivr-incoming)">Not linked</Badge>}
      </div>

      {mode === "mock" && (
        <p className="rounded-[12px] border border-dashed border-line px-4 py-3 text-[0.78rem] text-muted">
          Demo mode: calls shown here are sample data, not from Smartflo.
        </p>
      )}

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-[0.95rem]"><span className="ivr-badge-num">1</span>Your Smartflo agent</h3>
        {linkedAgent ? (
          <p className="text-[13px]">
            Linked to <b>{linkedAgent.name}</b>
            {linkedAgent.number ? ` · ${linkedAgent.number}` : ""}
            {linkedAgent.extension ? ` · ext ${linkedAgent.extension}` : ""}. The Call button rings this phone first, then connects the member.
          </p>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => linkMyAgentByPhone(phone), () => setPhone(""));
            }}
          >
            <p className="text-[13px] text-muted">
              Type the phone number registered on your Smartflo agent (your call-forward number). If it matches, we link your calls to this account.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="ivr-phone">
                Smartflo agent phone number
              </label>
              <input id="ivr-phone" className="input max-w-xs" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button className="btn btn-primary" disabled={pending || !phone.trim()}>
                Link my calls
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-[0.95rem]">
          <span className="ivr-badge-num">2</span>Call from your laptop{" "}
          <span className="font-sans text-[0.8rem] font-normal tracking-normal text-muted">(browser softphone)</span>
        </h3>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveMySoftphone(ext));
          }}
        >
          <p className="text-[13px] text-muted">
            Enter your Smartflo softphone extension (digits, like 060123456). The Call button then rings your Smartflo web phone instead of your mobile:
            answer it there and Smartflo connects the member. Keep the web phone open and set to Online. Leave it empty to use your phone.
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="ivr-ext">
              Smartflo softphone extension
            </label>
            <input id="ivr-ext" className="input max-w-xs font-mono" inputMode="numeric" placeholder="060123456" value={ext} onChange={(e) => setExt(e.target.value)} />
            <button className="btn btn-primary" disabled={pending || ext.trim() === softphoneExtension}>
              Save
            </button>
          </div>
          {detectedExtension && ext.trim() !== detectedExtension && (
            <p className="text-[12px] text-muted">
              Smartflo lists extension <b className="font-mono">{detectedExtension}</b> on your agent.{" "}
              <button type="button" className="underline" onClick={() => setExt(detectedExtension)}>
                Use it
              </button>
            </p>
          )}
        </form>
      </section>

      <section className="grid gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-[0.95rem]">
          <span className="ivr-badge-num">3</span>Backup Click-to-Call key <span className="font-sans text-[0.8rem] font-normal tracking-normal text-muted">(optional, only if your number cannot be linked above)</span>
        </h3>
        {hasKey ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge color="var(--ivr-done)">Key saved</Badge>
            <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => removeClickToCallKey(), () => setMsg({ ok: true, text: "Key removed" }))}>
              Remove key
            </button>
          </div>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveClickToCallKey(key), () => setKey(""));
            }}
          >
            <p className="text-[13px] text-muted">
              In Smartflo open API Connect, create a Click to Call Support key for your number, and paste it here. It is stored encrypted and never shown again.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="ivr-key">
                Click-to-Call API key
              </label>
              <input id="ivr-key" type="password" autoComplete="off" className="input max-w-xs" value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn btn-primary" disabled={pending || key.trim().length < 8}>
                Save key
              </button>
            </div>
          </form>
        )}
      </section>

      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </Alert>
      )}
    </div>
  );
}
