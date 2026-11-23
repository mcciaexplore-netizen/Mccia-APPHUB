/**
 * Watching rules, as plain functions (no database, so the server, the pages and the unit tests share them). A watcher is a hub user the
 * Support Admin gave one or more rules on their page in Administrator > Users. A rule is either
 *   - an approval type: HR, Expenditure (both expense types: one expense form) or Budget (budgets and their revisions), and for Expenditure
 *     optionally one expense category (null = all of them); or
 *   - a person (by user): every request that person submits, of any type (HR, Expenditure, Budget).
 * A watcher reads, prints and exports the requests their rules match and is told of new ones; watching never lets anyone decide anything.
 */
import type { AprRequestType, AprWatcherForm } from "@/db/approvals-schema";

export const WATCH_FORMS: readonly AprWatcherForm[] = ["hr", "expenditure", "budget"];
export const WATCH_FORM_LABEL: Record<AprWatcherForm, string> = { hr: "HR", expenditure: "Expenditure", budget: "Budget" };
/** As the rules table on a person's page names them. */
export const WATCH_FORM_TITLE: Record<AprWatcherForm, string> = { hr: "HR Approval", expenditure: "Expenditure", budget: "Budget" };

/**
 * One rule: an approval type (`form`), and for Expenditure an expense category's id (null: every category; HR and Budget always null); or,
 * with `watchedUserId`, everything that person submits (`form` and `categoryId` then null).
 */
export type WatchRule = { form: AprWatcherForm | null; categoryId: string | null; watchedUserId?: string | null };

const TYPES: Record<AprWatcherForm, AprRequestType[]> = {
  hr: ["hr"],
  expenditure: ["expenditure_large", "expenditure_small"],
  budget: ["budget"],
};
/** The request types an approval type covers. */
export const typesOfForm = (form: AprWatcherForm): AprRequestType[] => TYPES[form];
/** The approval type a request type belongs to. */
export const formOfType = (type: AprRequestType): AprWatcherForm => (type === "hr" ? "hr" : type === "budget" ? "budget" : "expenditure");
export const isWatchForm = (v: string): v is AprWatcherForm => (WATCH_FORMS as readonly string[]).includes(v);
/** Only Expenditure rules can name a category; HR and Budget ones are always "All". */
export const formHasCategories = (form: AprWatcherForm): boolean => form === "expenditure";

/** Whether a request (its type, an expenditure's expense category, and who submitted it) matches any of the rules. */
export function rulesMatch(rules: readonly WatchRule[], type: AprRequestType, categoryId: string | null, requesterId: string | null = null): boolean {
  const form = formOfType(type);
  return rules.some((r) =>
    r.watchedUserId ? !!requesterId && r.watchedUserId === requesterId : r.form === form && (r.categoryId === null || (form === "expenditure" && r.categoryId === categoryId)),
  );
}

/** Whether a rule watches a person (rather than an approval type). */
export const isUserRule = (r: WatchRule): boolean => !!r.watchedUserId;

/**
 * Who to tell about a new request among the people whose rules match it: each once, never the person who raised it, nor anyone already told
 * (the approver it went to).
 */
export function watcherRecipients(watchers: readonly string[], requesterId: string, alreadyTold: readonly string[]): string[] {
  const skip = new Set([requesterId, ...alreadyTold]);
  return [...new Set(watchers)].filter((id) => !skip.has(id));
}

/** The bell notice a watcher gets about a new request: "Asha Rao submitted a new Expenditure request". */
export const watcherNoticeTitle = (requesterName: string, type: AprRequestType): string => `${requesterName} submitted a new ${WATCH_FORM_LABEL[formOfType(type)]} request`;

/** The one list of everything a watcher's rules match. */
export const WATCHING_HREF = "/approvals/watching/all";
export const isWatchingPath = (parts: readonly string[]): boolean => parts.length === 2 && parts[0] === "watching" && parts[1] === "all";
