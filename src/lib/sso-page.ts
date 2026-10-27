import { randomBytes } from "node:crypto";

/**
 * The page that hands a signed token to an application: a form that posts it to the callback address by itself. It is a POST so the token
 * never sits in a URL (no history entry, no server log, no Referer). The response is built to be seen once by the person's own browser:
 * never cached, never framed, no Referer, and a policy that lets it run one inline script (this one, by nonce) and post to one origin.
 */

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const newNonce = () => randomBytes(16).toString("base64");

/** The headers every single sign-on response carries. `callbackOrigin` is the only place the page's form may post to. */
export function launchHeaders(callbackOrigin: string, nonce: string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${callbackOrigin}; base-uri 'none'; frame-ancestors 'none'`,
  };
}

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">`;

/** The self-submitting form. Without JavaScript the person gets a button instead. */
export function autoPostHtml(input: { callback: string; token: string; appName: string; nonce: string }): string {
  const name = escapeHtml(input.appName);
  return `<!doctype html>
<html lang="en"><head>${HEAD}<title>Signing you in</title></head>
<body>
<p>Signing you in to ${name}…</p>
<form id="sso" method="post" action="${escapeHtml(input.callback)}">
<input type="hidden" name="token" value="${escapeHtml(input.token)}">
<noscript><p>Your browser needs one more click to continue.</p><button type="submit">Continue to ${name}</button></noscript>
</form>
<script nonce="${input.nonce}">document.getElementById("sso").submit();</script>
</body></html>`;
}

/** A short page for a refusal or a failure, with an optional way back to the hub. */
export function messageHtml(title: string, message: string, backToHub = false): string {
  return `<!doctype html>
<html lang="en"><head>${HEAD}<title>${escapeHtml(title)}</title></head>
<body>
<p>${escapeHtml(message)}</p>${backToHub ? `\n<p><a href="/">Back to the hub</a></p>` : ""}
</body></html>`;
}

/** Headers for those short pages: no script at all, nothing cached. */
export const messageHeaders = (): Record<string, string> => ({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
});
