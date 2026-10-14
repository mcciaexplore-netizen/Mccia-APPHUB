import { Hammer } from "lucide-react";
import { PageHeader } from "@/components/approvals/PageHeader";

/** Shown if a menu item ever points at a screen that does not exist yet, so a link in the sidebar never lands on an error. */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="alert max-w-xl">
        <Hammer size={18} className="mt-0.5 shrink-0" />
        <span>This screen is not available yet.</span>
      </div>
    </>
  );
}
