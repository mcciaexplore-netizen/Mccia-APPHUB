import { normalizePhone } from "@/lib/ivr/phone";

export const FIELDS = [
  "name",
  "phone",
  "email",
  "company",
  "query",
  "source",
  "category",
  "memberCode",
  "agentRef",
  "agentPhone",
  "agentEmail",
  "agentName",
] as const;

export type FieldKey = (typeof FIELDS)[number];
export type Mapping = Record<FieldKey, number | null>;
export type Confidence = Record<FieldKey, number>;

export const FIELD_LABELS: Record<FieldKey, { label: string; hint: string; required?: boolean }> = {
  name: { label: "Member name", hint: "Who the member is" },
  phone: { label: "Member phone", hint: "Used to find duplicates", required: true },
  email: { label: "Member email", hint: "Used for the Email tab" },
  company: { label: "Organisation", hint: "Business or organisation" },
  query: { label: "Remarks", hint: "Any note that came with the row" },
  source: { label: "Source", hint: "Campaign or list name" },
  category: { label: "Call category", hint: "Purpose of the call, e.g. Proforma, Hall booking" },
  memberCode: { label: "Member code", hint: "Membership number or ID" },
  agentRef: { label: "Agent ID or extension", hint: "Smartflo agent ID or extension" },
  agentPhone: { label: "Agent phone", hint: "Assigned agent's mobile number" },
  agentEmail: { label: "Agent email", hint: "Assigned agent's email" },
  agentName: { label: "Agent name", hint: "Assigned agent's name" },
};

export const emptyMapping = (): Mapping =>
  Object.fromEntries(FIELDS.map((f) => [f, null])) as Mapping;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const SYNONYMS: Record<FieldKey, string[]> = {
  name: ["name", "leadname", "customername", "fullname", "contactname", "clientname", "person", "customer", "lead", "firstname", "party", "partyname"],
  phone: ["phone", "mobile", "mobileno", "mobilenumber", "phonenumber", "contactno", "contactnumber", "whatsapp", "whatsappnumber", "cell", "number", "customernumber", "clientnumber", "callernumber", "phoneno", "mob", "contact", "telephone", "tel"],
  email: ["email", "emailid", "mail", "emailaddress", "customeremail", "leademail", "mailid", "clientemail"],
  company: ["company", "companyname", "organisation", "organization", "firm", "business", "businessname", "enterprise", "unit", "unitname", "firmname"],
  query: ["query", "enquiry", "inquiry", "requirement", "requirements", "interest", "subject", "message", "remarks", "remark", "notes", "description", "issue", "problem", "topic", "queryfor", "enquiryfor", "service"],
  source: ["source", "leadsource", "channel", "campaign", "origin", "medium", "referral"],
  category: ["category", "callcategory", "purpose", "callpurpose", "reason", "callreason", "calltype", "callfor", "type"],
  memberCode: ["membercode", "memberid", "membershipno", "membershipnumber", "membershipid", "membershipcode", "memberno", "membernumber", "regno", "registrationno", "mid"],
  agentRef: ["agentid", "agentextension", "extension", "ext", "smartfloagentid", "agentcode", "userid", "assignedtoid", "ownerid", "agentext", "empid", "employeeid"],
  agentPhone: ["agentphone", "agentmobile", "agentnumber", "assignedtophone", "ownerphone", "agentcontact", "assignedtomobile", "telecallernumber", "agentmobileno"],
  agentEmail: ["assignedtoemail", "agentemail", "owneremail", "assigneeemail", "assignedemail", "telecalleremail", "executiveemail", "useremail", "agentmail", "assignedtomail", "agentemailid"],
  agentName: ["assignedto", "assignee", "agent", "agentname", "owner", "ownername", "telecaller", "executive", "salesperson", "handledby", "assignedagent", "assigned", "assignedname", "assignedtoname", "caller", "allocatedto", "allocated", "executivename", "telecallername"],
};

const AGENT_WORDS = /(agent|assign|owner|telecaller|executive|handled|allocat|salesperson|assignee)/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function headerScore(header: string, field: FieldKey): number {
  const h = norm(header);
  if (!h) return 0;
  const syn = SYNONYMS[field];
  if (syn.includes(h)) return 1;
  const isAgentField = field.startsWith("agent");
  const agentish = AGENT_WORDS.test(h);
  // "Agent Email" must not count as the lead's email, and "Assigned To" must not count as a lead name.
  if (!isAgentField && agentish) return 0;
  if (field === "email" && /e?mail/.test(h) && !agentish) return 0.85;
  if (field === "agentEmail" && /e?mail/.test(h) && agentish) return 0.95;
  if (field === "agentPhone" && /(phone|mobile|number|contact)/.test(h) && agentish) return 0.9;
  if (field === "agentRef" && /(id|ext|code)$/.test(h) && agentish) return 0.9;
  if (field === "agentName" && agentish) return 0.7;
  if (!isAgentField) {
    for (const t of syn) if (t.length >= 4 && h.includes(t)) return 0.7;
  }
  return 0;
}

type ColStats = { n: number; email: number; phone: number; nameLike: number; distinct: number };

function columnStats(rows: string[][], col: number): ColStats {
  const vals: string[] = [];
  for (const r of rows) {
    const v = (r[col] ?? "").trim();
    if (v) vals.push(v);
    if (vals.length >= 200) break;
  }
  const n = vals.length;
  if (!n) return { n: 0, email: 0, phone: 0, nameLike: 0, distinct: 0 };
  let email = 0;
  let phone = 0;
  let nameLike = 0;
  for (const v of vals) {
    if (EMAIL_RE.test(v)) email++;
    else if (/^[+()\d\s.-]{8,}$/.test(v) && normalizePhone(v)) phone++;
    else if (/^[A-Za-z][A-Za-z .'-]{1,60}$/.test(v) && /\s|^[A-Z]/.test(v)) nameLike++;
  }
  return { n, email: email / n, phone: phone / n, nameLike: nameLike / n, distinct: new Set(vals.map((v) => v.toLowerCase())).size / n };
}

export type Detection = { mapping: Mapping; confidence: Confidence };

export function detectColumns(headers: string[], rows: string[][]): Detection {
  const stats = headers.map((_, i) => columnStats(rows, i));
  type Cand = { col: number; field: FieldKey; score: number };
  const cands: Cand[] = [];

  headers.forEach((h, col) => {
    for (const field of FIELDS) {
      let score = headerScore(h, field);
      const s = stats[col];
      const agentish = AGENT_WORDS.test(norm(h));
      // Content sniffing backs up weak or missing header evidence.
      if (field === "phone" && !agentish && s.phone >= 0.8) score = Math.max(score, 0.6 + (score ? 0.1 : 0));
      if (field === "phone" && score > 0 && s.n && s.phone < 0.3 && s.email > 0.5) score = 0;
      if (field === "email" && !agentish && s.email >= 0.8) score = Math.max(score, 0.6);
      if (field === "agentEmail" && agentish && s.email >= 0.8) score = Math.max(score, 0.9);
      if (field === "agentPhone" && agentish && s.phone >= 0.8) score = Math.max(score, 0.85);
      if (field === "agentName" && score > 0 && s.email >= 0.8) score = Math.max(0.3, score - 0.4);
      if (field === "name" && !agentish && s.nameLike >= 0.8 && s.distinct > 0.5) score = Math.max(score, 0.4);
      if (score > 0) cands.push({ col, field, score });
    }
  });

  // When two columns look like emails and headers do not settle it, the one with few distinct values is the agent (many leads per agent).
  const emailCols = headers
    .map((_, i) => i)
    .filter((i) => stats[i].email >= 0.8 && !AGENT_WORDS.test(norm(headers[i])));
  if (emailCols.length >= 2) {
    const sorted = [...emailCols].sort((a, b) => stats[a].distinct - stats[b].distinct);
    cands.push({ col: sorted[0], field: "agentEmail", score: 0.65 });
  }

  cands.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping = emptyMapping();
  const confidence = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Confidence;
  const usedCols = new Set<number>();
  for (const c of cands) {
    if (mapping[c.field] !== null || usedCols.has(c.col)) continue;
    mapping[c.field] = c.col;
    confidence[c.field] = c.score;
    usedCols.add(c.col);
  }
  return { mapping, confidence };
}

/** Columns not mapped to any field are kept on the lead in `extra`, keyed by their header. */
export function extraColumns(headers: string[], mapping: Mapping): number[] {
  const used = new Set(Object.values(mapping).filter((v): v is number => v !== null));
  return headers.map((_, i) => i).filter((i) => !used.has(i));
}

/** Validate a mapping coming from the client against the actual number of columns. */
export function sanitizeMapping(input: unknown, width: number): Mapping {
  const out = emptyMapping();
  if (!input || typeof input !== "object") return out;
  const used = new Set<number>();
  for (const f of FIELDS) {
    const v = (input as Record<string, unknown>)[f];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < width && !used.has(v)) {
      out[f] = v;
      used.add(v);
    }
  }
  return out;
}
