"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { checkStorageAction, deleteAllAction, saveSlackAction, testEmailAction } from "@/lib/aistudio/actions/admin";
import { useAct } from "../use-act";
import { Card } from "../ui";

/** Settings: Slack for new requests, a test email, the file storage check; and, for the Support Admin, deleting all data. */
export function SettingsView({ slackWebhook, superAdmin }: { slackWebhook: string; superAdmin: boolean }) {
  const toast = useToast();
  const { act, pending } = useAct();
  const [hook, setHook] = useState(slackWebhook);
  const [confirmText, setConfirmText] = useState("");
  const [checking, setChecking] = useState(false);
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card title="Slack">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => saveSlackAction(hook));
          }}
        >
          <label className="ai-label flex flex-col gap-1">
            Incoming webhook (optional): new requests are posted here
            <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://hooks.slack.com/services/..." />
          </label>
          <button className="btn btn-sm ai-btn-navy self-start" disabled={pending}>
            Save
          </button>
        </form>
      </Card>
      <Card title="Email and file storage">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              const r = await testEmailAction();
              setChecking(false);
              if (r.ok) toast.success(r.data);
              else toast.error(r.error);
            }}
          >
            Send me a test email
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              const r = await checkStorageAction();
              setChecking(false);
              if (!r.ok) toast.error(r.error);
              else if (r.data.ok) toast.success(r.data.message);
              else toast.error(r.data.message);
            }}
          >
            Check file storage
          </button>
        </div>
      </Card>
      {superAdmin && (
        <Card title="Delete all data">
          <p className="text-sm text-ink">Deletes every AI Studio request, note, history line and stored file. Request numbers carry on (no number is used twice).</p>
          <label className="ai-label mt-3 flex flex-col gap-1">
            Type DELETE to confirm
            <input className="input max-w-xs" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-sm btn-danger mt-3"
            disabled={pending || confirmText !== "DELETE"}
            onClick={async () => {
              const r = await act(() => deleteAllAction(confirmText), { quiet: true });
              if (r.ok) toast.success(`Deleted ${r.data.requests} request${r.data.requests === 1 ? "" : "s"}.`);
              setConfirmText("");
            }}
          >
            Delete all data
          </button>
        </Card>
      )}
    </div>
  );
}
