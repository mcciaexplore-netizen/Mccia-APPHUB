/** MCCIA's offices, offered as quick picks in the booking form's address boxes (with their map positions). */
export type Office = { name: string; address: string; lat: number; lng: number };

export const MCCIA_OFFICES: Office[] = [
  { name: "MCCIA SB Road Office", address: "403 - A, Senapati Bapat Rd, Laxmi Society, Model Colony, Shivajinagar, Pune, Maharashtra 411016", lat: 18.5308, lng: 73.8475 },
  { name: "MCCIA Hadapsar Office", address: "Plot No. 7, A, HADAPSAR INDUSTRIAL ESTATE-2, 3, Hadapsar Industrial Estate, Hadapsar, Pune, Maharashtra 411013", lat: 18.5089, lng: 73.9259 },
  { name: "MCCIA Ahilyanagar Office", address: "MCCIA Building, Plot No. P 86, MIDC, Nagapur, Maharashtra 414111", lat: 18.706, lng: 75.706 },
  { name: "MCCIA Tilak Road Office", address: "Central Chamber, 1023, Tilak Rd, Dadawadi, Shukrawar Peth, Pune, Maharashtra 411002", lat: 18.5162, lng: 73.8561 },
  { name: "MCCIA Bhosari Office", address: "J-462, Telco Rd, Ganesh Nagar, Bhosari, Pune, Pimpri-Chinchwad, Maharashtra 411026", lat: 18.6298, lng: 73.8553 },
  { name: "Auto Cluster", address: "MIDC, Chinchwad, Pimpri-Chinchwad, Maharashtra 411019", lat: 18.6465, lng: 73.7942 },
];

/** What goes in the address box when an office is chosen: its name, then its address. */
export const officeText = (o: Office) => `${o.name}, ${o.address}`;

/** Words that only ask for the offices: they are not matched against any one office. ("cluster" also asks, but names the Auto Cluster.) */
const KEYWORDS = /\b(mccia|office|offices)\b/gi;

/**
 * The offices to offer for what is typed: all of them while the box is (almost) empty; when the text mentions "MCCIA", "office" or
 * "cluster", those whose name or address has every other word typed ("mccia hadapsar" → the Hadapsar office, "cluster" → the Auto Cluster);
 * otherwise none.
 */
export function officesFor(text: string): Office[] {
  const t = text.trim();
  if (t.length < 2) return MCCIA_OFFICES;
  if (!/\b(mccia|office|offices|cluster)/i.test(t)) return [];
  const rest = t.replace(KEYWORDS, " ").toLowerCase().split(/[\s,]+/).filter(Boolean);
  return MCCIA_OFFICES.filter((o) => rest.every((w) => `${o.name} ${o.address}`.toLowerCase().includes(w)));
}
