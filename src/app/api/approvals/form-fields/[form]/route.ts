import { ApprovalsError } from "@/lib/approvals/errors";
import { formKeyInput, getFormFields, saveFieldsInput, saveFormFields } from "@/lib/approvals/form-config";
import { ok, readJson, route } from "@/lib/approvals/guard";

export const dynamic = "force-dynamic";

const formOf = (raw: string) => {
  const f = formKeyInput.safeParse(raw);
  if (!f.success) throw new ApprovalsError("Unknown form.", 404);
  return f.data;
};

export const GET = route<{ form: string }>({ roles: ["approvals_admin"] }, async ({ params }) => ok({ fields: await getFormFields(formOf(params.form)) }));

/** Saves a form's layout: its built-in fields (renamed, moved, hidden) and the extra fields, top to bottom. */
export const PUT = route<{ form: string }>({ roles: ["approvals_admin"] }, async ({ req, user, params }) =>
  ok({ fields: await saveFormFields(formOf(params.form), await readJson(req, saveFieldsInput), user) }));
