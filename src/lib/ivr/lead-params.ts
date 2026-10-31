import { isStage, type StageKey } from "./stage";
import { addDays, istDayStart } from "./time";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type LeadQuery = {
  stage: StageKey | undefined;
  /** Category id filter. */
  cat: string | undefined;
  q: string;
  when: "all" | "today" | "week" | "month";
  page: number;
  lead: string | undefined;
  owner: string | undefined;
  unassigned: boolean;
  from: Date | undefined;
  to: Date | undefined;
};

export function parseLeadQuery(sp: SP, defaultStage?: StageKey): LeadQuery {
  const stageRaw = one(sp.stage);
  const whenRaw = one(sp.when);
  const when = (["today", "week", "month"].includes(whenRaw ?? "") ? whenRaw : "all") as LeadQuery["when"];
  const today = istDayStart();
  let from: Date | undefined;
  let to: Date | undefined;
  if (when === "today") {
    from = today;
    to = addDays(today, 1);
  } else if (when === "week") {
    from = addDays(today, -6);
    to = addDays(today, 1);
  } else if (when === "month") {
    from = addDays(today, -29);
    to = addDays(today, 1);
  }
  return {
    stage: isStage(stageRaw) ? stageRaw : stageRaw === "all" ? undefined : defaultStage,
    cat: one(sp.cat),
    q: (one(sp.q) ?? "").slice(0, 100),
    when,
    page: Math.max(1, parseInt(one(sp.page) ?? "1", 10) || 1),
    lead: one(sp.lead),
    owner: one(sp.owner),
    unassigned: one(sp.unassigned) === "1",
    from,
    to,
  };
}

/** Build a query string for links, keeping the filters the user already chose. */
export function qs(sp: SP, patch: Record<string, string | null>): string {
  const n = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val) n.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) n.delete(k);
    else n.set(k, v);
  }
  n.delete("page");
  const s = n.toString();
  return s ? `?${s}` : "";
}
