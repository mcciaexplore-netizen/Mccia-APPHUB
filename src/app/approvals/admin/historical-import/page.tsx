import { redirect } from "next/navigation";

/** The import page's first address: it lives at /approvals/admin/import now. */
export default function Page() {
  redirect("/approvals/admin/import");
}
