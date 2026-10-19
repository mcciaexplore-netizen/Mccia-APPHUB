import { redirect } from "next/navigation";

/** Approval Forms has a page per form now (HR, Expenditure); the old address opens the HR one. */
export default function Page() {
  redirect("/administrator/approval-forms/hr");
}
