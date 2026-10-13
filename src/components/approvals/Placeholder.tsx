import { Hammer } from "lucide-react";
import { PageHeader } from "@/components/approvals/PageHeader";

const PHASES: Record<number, string> = {
  2: "Requests: the forms, uploads and budget checks",
  3: "Approvals: routing, the approver inbox, approve and reject",
  4: "Lists and reports: filters, export, the detail drawer and timelines",
  5: "Notifications and reminders",
  6: "Masters import and hardening",
};

/** Shown for menu items whose screen has not been built yet, so every link in the sidebar already works. */
export function Placeholder({ title, phase }: { title: string; phase?: number }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="alert max-w-xl">
        <Hammer size={18} className="mt-0.5 shrink-0" />
        <span>
          This screen is not built yet{phase ? <>: it arrives in phase {phase} ({PHASES[phase] ?? "later"})</> : null}.
        </span>
      </div>
    </>
  );
}
