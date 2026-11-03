/**
 * The design request form: the eleven kinds of design and the questions each asks, the limits, and the checks on what is sent. Pure, so
 * the form page, the server and the unit tests share it. The kinds are seeded into design_types (scripts/apply-0037-design.sql); a lead
 * can rename them, change their turnaround or switch them off, and add new ones (which ask only the language question).
 */
import { z } from "zod";
import type { DesignQuestion } from "@/db/design-schema";
import { daysBetween, istDate } from "./rules";

export const MAX_FILES = 5;
export const MAX_FILE_MB = 10;
export const MAX_CDR_MB = 50;
export const MAX_REFERENCE_LINKS = 5;
export const MAX_ANSWER_LENGTH = 200;

const q = (id: string, label: string, type: DesignQuestion["type"] = "text", options?: string[], required = false): DesignQuestion => ({
  id,
  label,
  type,
  ...(options ? { options } : {}),
  ...(required ? { required } : {}),
});
export const LANGUAGE_QUESTION = q("language", "Language", "select", ["English", "Hindi", "Marathi"]);

export type SeedType = { key: string; name: string; slaHours: number; effortHours: number; questions: DesignQuestion[] };

/**
 * Kinds of design no longer offered on the request form: "Photo / video / reel" (media). Old tickets of that kind keep showing as before;
 * only new requests cannot choose it, even where the row is still switched on in an older database.
 */
export const RETIRED_TYPE_KEYS: readonly string[] = ["media"];

/** The form's eleven choices, in the order shown. */
export const SEED_TYPES: SeedType[] = [
  { key: "flyer", name: "Flyer", slaHours: 24, effortHours: 3, questions: [
    q("size", "Size", "select", ["A4", "A5", "Square", "Custom"], true),
    q("custom_size", "Custom size (if Custom)"),
    q("channel", "Print or email?", "select", ["Email", "Print"], true),
    LANGUAGE_QUESTION,
  ] },
  { key: "whatsapp", name: "WhatsApp creative", slaHours: 24, effortHours: 2, questions: [q("message", "Message or call-to-action to show on it"), LANGUAGE_QUESTION] },
  { key: "instagram", name: "Instagram post", slaHours: 48, effortHours: 3, questions: [
    q("slides", "Number of slides (for a carousel)", "number"),
    q("tag", "Account or people to tag"),
    LANGUAGE_QUESTION,
  ] },
  { key: "linkedin", name: "LinkedIn post", slaHours: 48, effortHours: 3, questions: [
    q("slides", "Number of slides (for a carousel)", "number"),
    q("tag", "Page or people to tag"),
    LANGUAGE_QUESTION,
  ] },
  { key: "twitter", name: "Twitter / X post", slaHours: 48, effortHours: 2, questions: [LANGUAGE_QUESTION] },
  { key: "banner", name: "Banner / standee", slaHours: 24, effortHours: 4, questions: [
    q("size", "Size (width x height)", "text", undefined, true),
    q("medium", "Print or digital?", "select", ["Print", "Digital"], true),
    q("quantity", "Quantity", "number"),
    LANGUAGE_QUESTION,
  ] },
  { key: "backdrop", name: "Backdrop / slides", slaHours: 48, effortHours: 6, questions: [
    q("slides", "Number of slides", "number", undefined, true),
    q("aspect_ratio", "Aspect ratio", "select", ["16:9", "4:3"], true),
    LANGUAGE_QUESTION,
  ] },
  { key: "book", name: "Book", slaHours: 96, effortHours: 16, questions: [
    q("pages", "Number of pages", "number", undefined, true),
    q("content_ready", "Is the content ready?", "select", ["Yes, all of it", "Partly", "No"], true),
    LANGUAGE_QUESTION,
  ] },
  { key: "brochure2", name: "2-page brochure", slaHours: 72, effortHours: 8, questions: [q("copy", "Copy", "select", ["Copy provided", "Needs writing"], true), LANGUAGE_QUESTION] },
  { key: "brochure4", name: "4-page brochure", slaHours: 96, effortHours: 12, questions: [q("copy", "Copy", "select", ["Copy provided", "Needs writing"], true), LANGUAGE_QUESTION] },
  { key: "other", name: "Other", slaHours: 48, effortHours: 4, questions: [q("describe", "Describe the design you need", "text", undefined, true), LANGUAGE_QUESTION] },
];

export type FormType = { key: string; name: string; questions: DesignQuestion[] };
export type Answers = Record<string, Record<string, string | number>>;

/** Checks one design's answers against its questions. Returns only known, non-empty answers, or the first problem. */
export function cleanAnswers(type: FormType, sent: Record<string, unknown>, prefix = ""): { ok: true; answers: Record<string, string | number> } | { ok: false; error: string } {
  const answers: Record<string, string | number> = {};
  for (const question of type.questions) {
    const label = prefix + question.label;
    const raw = sent?.[question.id];
    let value: string | number = raw == null ? "" : String(raw).trim();
    if (value && question.type === "select" && !question.options?.includes(value)) return { ok: false, error: `${label}: please choose from the list` };
    if (value && question.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
      if (!(n > 0 && n < 100000)) return { ok: false, error: `${label} must be a number above 0` };
      value = n;
    } else if (typeof value === "string" && value.length > MAX_ANSWER_LENGTH) return { ok: false, error: `${label} is too long` };
    if (value === "") {
      if (question.required) return { ok: false, error: `${label} is required` };
      continue;
    }
    answers[question.id] = value;
  }
  return { ok: true, answers };
}

export const requestInput = z.object({
  requirements: z.array(z.string().min(1)).min(1, "Choose at least one kind of design").max(12),
  details: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  brief: z.string().trim().min(5, "Write a short brief: what the design is for and what it should say").max(5000, "The brief is too long"),
  eventName: z.string().trim().max(200, "The event name is too long").default(""),
  eventDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid event date")]).default(""),
  department: z.string().trim().max(120, "The department name is too long").default(""),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date you need it by"),
  referenceLinks: z.array(z.string().trim()).max(20).default([]),
  fileIds: z.array(z.string().uuid()).max(MAX_FILES, `Attach at most ${MAX_FILES} files`).default([]),
});
export type RequestInput = z.input<typeof requestInput>;

export type CleanRequest = {
  requirements: string[];
  details: Answers;
  brief: string;
  eventName: string | null;
  eventDate: string | null;
  department: string | null;
  deliveryDate: string;
  referenceLinks: string[];
  fileIds: string[];
};

/** Up to five web links (http:// or https://); blank rows are ignored. */
export function cleanLinks(links: string[]): { ok: true; links: string[] } | { ok: false; error: string } {
  const out = links.map((l) => l.trim()).filter(Boolean);
  if (out.length > MAX_REFERENCE_LINKS) return { ok: false, error: `Reference links: add at most ${MAX_REFERENCE_LINKS}` };
  for (const l of out) {
    if (l.length > 500) return { ok: false, error: "Reference links: a link is longer than 500 characters" };
    let ok = false;
    try {
      const u = new URL(l);
      ok = (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && !/\s/.test(l);
    } catch {
      ok = false;
    }
    if (!ok) return { ok: false, error: `Reference links: ${l.slice(0, 60)} must be a full web link, starting with https://` };
  }
  return { ok: true, links: out };
}

/** Every check on a request, before anything is stored. `types` are the active kinds of design, by key. */
export function checkRequest(input: RequestInput, types: Map<string, FormType>, today: string = istDate()): { ok: true; value: CleanRequest } | { ok: false; error: string } {
  const p = requestInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the form" };
  const v = p.data;
  const requirements = [...new Set(v.requirements)];
  const unknown = requirements.find((r) => !types.has(r));
  if (unknown) return { ok: false, error: "One of the designs chosen is no longer offered. Reload the page and choose again." };
  if (daysBetween(today, v.deliveryDate) < 1) return { ok: false, error: "The delivery date must be tomorrow or later" };
  if (v.eventDate && daysBetween(today, v.eventDate) < 0) return { ok: false, error: "The event date cannot be in the past" };
  const details: Answers = {};
  for (const r of requirements) {
    const t = types.get(r)!;
    const res = cleanAnswers(t, (v.details[r] ?? {}) as Record<string, unknown>, requirements.length > 1 ? `${t.name} – ` : "");
    if (!res.ok) return res;
    details[r] = res.answers;
  }
  const links = cleanLinks(v.referenceLinks);
  if (!links.ok) return links;
  return {
    ok: true,
    value: {
      requirements,
      details,
      brief: v.brief,
      eventName: v.eventName || null,
      eventDate: v.eventDate || null,
      department: v.department || null,
      deliveryDate: v.deliveryDate,
      referenceLinks: links.links,
      fileIds: [...new Set(v.fileIds)],
    },
  };
}

/** The ticket's title: the event (or the start of the brief) and the designs asked for. */
export function ticketTitle(r: Pick<CleanRequest, "eventName" | "brief" | "requirements">, names: Map<string, string>): string {
  const what = r.requirements.map((k) => names.get(k) ?? k).join(", ");
  const lead = r.eventName || r.brief.split("\n")[0].slice(0, 60).trim();
  return `${lead} – ${what}`.slice(0, 200);
}

/** The answers as readable lines, per design, for emails and the ticket page. */
export function answerLines(requirements: string[], details: Answers, types: Map<string, FormType>): { design: string; lines: string[] }[] {
  return requirements.map((k) => {
    const t = types.get(k);
    const labels = new Map((t?.questions ?? []).map((x) => [x.id, x.label]));
    return { design: t?.name ?? k, lines: Object.entries(details[k] ?? {}).map(([id, v]) => `${labels.get(id) ?? id}: ${v}`) };
  });
}

/** Upload limits per purpose, in bytes. */
export const uploadLimit = (purpose: "attachment" | "proof" | "cdr" | "library" | "post_image") => (purpose === "cdr" || purpose === "library" ? MAX_CDR_MB : MAX_FILE_MB) * 1024 * 1024;
