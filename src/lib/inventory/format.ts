/** Money and numbers for the Inventory screens. No server-only imports, so client components use them too. */

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
const whole = new Intl.NumberFormat("en-IN");

/** 125050 → "₹1,250.5"; null → "—". */
export const formatRupees = (paise: number | null | undefined) => (paise == null ? "—" : inr.format(paise / 100));
/** 125050 → "1250.50", for putting a stored rate back into a form field. */
export const paiseToInput = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2).replace(/\.00$/, ""));
export const formatCount = (n: number) => whole.format(n);
