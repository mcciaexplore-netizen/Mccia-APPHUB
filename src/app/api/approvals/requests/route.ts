import { z } from "zod";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { submitBudget, submitExpenditure, submitHrRequest } from "@/lib/approvals/requests";
import { budgetRequestInput, hrRequestInput, largeExpenditureInput, smallExpenditureInput } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("kind", [
  hrRequestInput.extend({ kind: z.literal("hr") }),
  largeExpenditureInput.extend({ kind: z.literal("large") }),
  smallExpenditureInput.extend({ kind: z.literal("small") }),
  budgetRequestInput.extend({ kind: z.literal("budget") }),
]);

/** Submits an HR request (kind "hr"), an expenditure of ₹10,000 and above ("large"), one below it ("small"), or a budget ("budget"). */
export const POST = route({}, async ({ req, user }) => {
  await rateLimit("submit", user.id, 30, 600);
  const input = await readJson(req, body);
  const made = input.kind === "hr" ? await submitHrRequest(input, user) : input.kind === "budget" ? await submitBudget(input, user) : await submitExpenditure(input.kind, input, user);
  return ok(made, 201);
});
