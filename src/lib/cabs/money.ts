/** Paise as rupees for the screen: "₹1,250.50", "₹35". The Cab Booking module's own. */
export const formatRupees = (paise: number | null | undefined) =>
  paise == null ? "—" : `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Paise as a plain number of rupees for a form or a CSV: "1250.5". */
export const paiseToRupees = (paise: number | null | undefined) => (paise == null ? "" : String(paise / 100));
