import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/approvals/PageHeader";
import { requirePage } from "@/lib/approvals/guard";
import { setupChecklist } from "@/lib/approvals/setup";

export const metadata = { title: "Setup · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const checklist = await setupChecklist();
  return (
    <>
      <PageHeader title="Setup" intro="What still has to be filled in before staff can use the forms. Click a line to go and do it." />
      <ul className="max-w-2xl divide-y divide-[var(--z-line)] rounded-sm border border-[var(--z-line)]">
        {checklist.map((c) => (
          <li key={c.label}>
            <Link href={c.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-[#f7f8f9]">
              {c.done ? <CheckCircle2 size={18} className="shrink-0 text-[var(--z-green)]" /> : <Circle size={18} className="shrink-0 text-[#aaa]" />}
              <span className="font-bold">{c.label}</span>
              <span className="ml-auto text-right text-xs text-[var(--z-muted)]">{c.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
