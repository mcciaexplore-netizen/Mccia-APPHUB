import { randomBytes } from "node:crypto";

/**
 * The page that hands a signed token to an application: a form that posts it to the callback address by itself. It is a POST so the token
 * never sits in a URL (no history entry, no server log, no Referer). The response is built to be seen once by the person's own browser:
 * never cached, never framed, no Referer, and a policy that lets it run one inline script and one inline style (by nonce), show the hub's own
 * logo, and post to one origin. Every application with single sign-on gets this same page from /launch/<slug>.
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; form-action ${callbackOrigin}; base-uri 'none'; frame-ancestors 'none'`,
  };
}

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">`;

/** How long the "Signing you in" screen shows before the form posts itself. Well inside the token's 60 s life. */
const HANDOFF_DELAY_MS = 100;

/** The hand-off screen's look: the hub's colours, a centred card with the logo and a spinner (still for people who ask for less motion). */
const HANDOFF_CSS = `*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#f4f7f8;color:#1f2a30;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:360px;padding:32px 24px;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(42,107,124,.12);text-align:center;animation:rise .35s ease-out}
.logo{height:40px;width:auto;margin:0 auto 24px;display:block}
.spin{width:36px;height:36px;margin:0 auto 18px;border-radius:50%;border:3px solid #d5e5ea;border-top-color:#2a6b7c;animation:spin .8s linear infinite}
p{margin:0;font-size:16px;line-height:1.5}
.sub{margin-top:6px;font-size:13px;color:#5b6b72}
button{margin-top:16px;padding:10px 18px;border:0;border-radius:10px;background:#2a6b7c;color:#fff;font-size:15px;cursor:pointer}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.spin,.card{animation:none}}
@media (prefers-color-scheme:dark){body{background:#0f171a;color:#e6eef0}.card{background:#172327;box-shadow:none}.sub{color:#9fb1b7}.spin{border-color:#2b3d43;border-top-color:#5fb0c4}}`;

/** The self-submitting form behind a short "Signing you in" screen. Without JavaScript the person gets a button instead. */
export function autoPostHtml(input: { callback: string; token: string; appName: string; nonce: string }): string {
  const name = escapeHtml(input.appName);
  return `<!doctype html>
<html lang="en"><head>${HEAD}<title>Signing you in</title><style nonce="${input.nonce}">${HANDOFF_CSS}</style></head>
<body>
<main class="card" role="status" aria-live="polite">
<img class="logo" src="/mccia-logo.png" alt="MCCIA">
<div class="spin" aria-hidden="true"></div>
<p>Signing you in to ${name}…</p>
<p class="sub">This takes a moment.</p>
<form id="sso" method="post" action="${escapeHtml(input.callback)}">
<input type="hidden" name="token" value="${escapeHtml(input.token)}">
<noscript><p class="sub">Your browser needs one more click to continue.</p><button type="submit">Continue to ${name}</button></noscript>
</form>
</main>
<script nonce="${input.nonce}">setTimeout(function(){document.getElementById("sso").submit();},${HANDOFF_DELAY_MS});</script>
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
