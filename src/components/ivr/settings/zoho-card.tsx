import { Mail } from "lucide-react";
import { disconnectZohoAction } from "@/lib/ivr/actions/email";
import { Badge } from "@/components/ivr/ui";

export function ZohoCard({ connected, account }: { connected: boolean; account: string | null }) {
  return (
    <div className="ivr-card card-lift grid gap-4 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="ivr-icon-tile ivr-icon-tile-green">
            <Mail />
          </span>
          <h2 className="text-xl">Zoho Mail</h2>
        </div>
        <Badge color={connected ? "var(--ivr-done)" : "var(--ivr-muted)"}>{connected ? "Connected" : "Not connected"}</Badge>
      </div>
      {connected ? (
        <>
          <p className="text-[0.85rem]">
            Sending as <span className="font-mono">{account ?? "your Zoho mailbox"}</span>.
          </p>
          <form action={disconnectZohoAction}>
            <button type="submit" className="btn btn-ghost">
              Disconnect
            </button>
          </form>
        </>
      ) : (
        <a href="/api/ivr/zoho/connect" className="btn btn-primary w-fit">
          Connect Zoho Mail
        </a>
      )}
      <p className="text-[0.78rem] text-muted">
        Lets you email leads from the lead panel. Messages are sent from your own mailbox and logged on the lead.
      </p>
    </div>
  );
}
