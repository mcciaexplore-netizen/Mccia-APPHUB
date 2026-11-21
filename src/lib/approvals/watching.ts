/**
 * Watchers, as plain rules (no database, so the server, the pages and the unit tests share them). A watcher is a hub user the Support Admin
 * picked to read every request of one form, print and export them, and be told of each new one, without ever deciding anything. Which
 * request types a form covers: HR its HR requests; Expenditure both expense types (one expense form); Budget budgets and their revisions.
 */
import type { AprRequestType, AprWatcherForm } from "@/db/approvals-schema";

export const WATCH_FORMS: readonly AprWatcherForm[] = ["hr", "expenditure", "budget"];
export const WATCH_FORM_LABEL: Record<AprWatcherForm, string> = { hr: "HR", expenditure: "Expenditure", budget: "Budget" };

const TYPES: Record<AprWatcherForm, AprRequestType[]> = {
  hr: ["hr"],
  expenditure: ["expenditure_large", "expenditure_small"],
  budget: ["budget"],
};
/** The request types a form covers. */
export const typesOfForm = (form: AprWatcherForm): AprRequestType[] => TYPES[form];
/** The form a request type belongs to. */
export const formOfType = (type: AprRequestType): AprWatcherForm => (type === "hr" ? "hr" : type === "budget" ? "budget" : "expenditure");
export const isWatchForm = (v: string): v is AprWatcherForm => (WATCH_FORMS as readonly string[]).includes(v);

/** Whether someone who watches `forms` may read a request of this type because of it. */
export const watchesType = (forms: readonly AprWatcherForm[], type: AprRequestType): boolean => forms.includes(formOfType(type));

/**
 * Who to tell about a new request among the watchers of its form: each once, never the person who raised it, nor anyone already told (the
 * approver it went to).
 */
export function watcherRecipients(watchers: readonly string[], requesterId: string, alreadyTold: readonly string[]): string[] {
  const skip = new Set([requesterId, ...alreadyTold]);
  return [...new Set(watchers)].filter((id) => !skip.has(id));
}

/** The bell notice a watcher gets about a new request: "Asha Rao submitted a new Expenditure request". */
export const watcherNoticeTitle = (requesterName: string, type: AprRequestType): string => `${requesterName} submitted a new ${WATCH_FORM_LABEL[formOfType(type)]} request`;

/** The list of a watched form: /approvals/watching/<form>. */
export const watchingHref = (form: AprWatcherForm): string => `/approvals/watching/${form}`;
export const parseWatchingPath = (parts: readonly string[]): AprWatcherForm | null => (parts.length === 2 && parts[0] === "watching" && isWatchForm(parts[1]) ? parts[1] : null);
