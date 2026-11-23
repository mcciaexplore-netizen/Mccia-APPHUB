/**
 * Payment Desk, for the host. Payment Desk is its own site (payment-advice.vercel.app), with its own sign-in and its own data; the hub only
 * shows it inside a hub page, /payment-desk, so people stay in the hub. Pure data and functions (no server code), so the unit tests can
 * import it too.
 *
 * Nothing about Payment Desk is stored in the hub: no passwords, no data, no tables. The hub passes one thing, the signed-in person's email,
 * so Payment Desk can fill in its own sign-in form; Payment Desk still checks the password itself.
 *
 * The application row in Administrator → Applications keeps Payment Desk's own address. Any application whose address is on Payment Desk's
 * site opens /payment-desk instead of a new tab (see embeddedHubPath). An administrator may also set its URL to /payment-desk directly:
 * that opens the same page.
 */

export const PAYMENT_DESK_PATH = "/payment-desk";
export const PAYMENT_DESK_ORIGIN = "https://payment-advice.vercel.app";

/** The address the hub page frames: embed mode, with the person's email for Payment Desk's own sign-in form. */
export const paymentDeskEmbedUrl = (email: string) => `${PAYMENT_DESK_ORIGIN}/?embed=1&email=${encodeURIComponent(email)}`;

/**
 * The hub page an outside application opens in, or null when it has none (it then opens in a new tab as before). Only Payment Desk's own
 * site over https counts, by exact host name, so a look-alike address (payment-advice.vercel.app.example.com) does not.
 */
export function embeddedHubPath(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  return u.protocol === "https:" && u.host === new URL(PAYMENT_DESK_ORIGIN).host ? PAYMENT_DESK_PATH : null;
}
