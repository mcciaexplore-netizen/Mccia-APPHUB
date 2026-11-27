/**
 * The App Hub's profile photo and dark mode, the pure rules: what a photo may be (size, and its type from its bytes, not its name), the
 * initials shown instead, which pages get the hub's dark mode and which keep their own look, and the first-paint script that applies it.
 * Run as part of `npm run test:unit` (tests/unit.ts calls hubProfileUnit()).
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { MAX_AVATAR_BYTES, avatarSizeProblem, initialsOf, sniffAvatar } from "../src/lib/avatar-rules";
import { HUB_DARK_EXCLUDED, HUB_THEME_KEY, HUB_THEME_SCRIPT, hubDarkAllowed, isHubDark, parseHubThemePref } from "../src/lib/hub-theme-rules";

type Eq = (name: string, got: unknown, want: unknown) => void;

const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const WEBP = Uint8Array.from([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")]);

/** Runs the first-paint script as a browser would: with this address, this saved choice and this device setting. Returns the classes it set. */
function firstPaint(path: string, saved: string | null, systemDark: boolean, storageBroken = false): string[] {
  const added: string[] = [];
  runInNewContext(HUB_THEME_SCRIPT, {
    location: { pathname: path },
    localStorage: { getItem: (k: string) => { if (storageBroken) throw new Error("blocked"); return k === HUB_THEME_KEY ? saved : null; } },
    window: { matchMedia: () => ({ matches: systemDark }) },
    document: { documentElement: { classList: { add: (c: string) => added.push(c) } } },
  });
  return added;
}

export function hubProfileUnit(eq: Eq): void {
  // Profile photo
  eq("avatar: the picture's type comes from its bytes: JPEG, PNG and WebP are accepted", [sniffAvatar(JPEG), sniffAvatar(PNG), sniffAvatar(WEBP)], [
    { mime: "image/jpeg", ext: "jpg" }, { mime: "image/png", ext: "png" }, { mime: "image/webp", ext: "webp" },
  ]);
  eq("avatar: anything else is refused whatever it is called: SVG (can carry script), GIF, PDF, a text file, a RIFF file that is not WebP, empty, too short",
    [ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"), ascii("GIF89a....."), ascii("%PDF-1.7 ......"), ascii("just some text"), Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]), bytes(), bytes(0xff, 0xd8)].map(sniffAvatar),
    [null, null, null, null, null, null, null]);
  eq("avatar: 2 MB is the limit: exactly 2 MB is fine, a byte more is refused, and an empty file is refused", [avatarSizeProblem(MAX_AVATAR_BYTES), avatarSizeProblem(1), /larger than 2 MB/.test(avatarSizeProblem(MAX_AVATAR_BYTES + 1) ?? ""), avatarSizeProblem(0) !== null], [null, null, true, true]);
  eq("avatar initials: the first letters of the first two words in capitals (AI Studio is AS)", ["AI Studio", "Vedshri Dikkar", "  mary   jane  smith ", "Mary-Jane O'Neil"].map(initialsOf), ["AS", "VD", "MJ", "MO"]);
  eq("avatar initials: one word gives its first two letters; letters of other scripts work; nothing usable gives ?", ["Admin", "a", "राहुल शर्मा", "(--)", "", "   "].map(initialsOf), ["AD", "A", "रश", "?", "?", "?"]);

  // Dark mode rules
  eq("hub dark: the home page, Administrator, notifications and the modules built on the hub's tokens get dark mode", ["/", "/administrator", "/administrator/users/abc", "/notifications", "/team", "/approvals/hr", "/inventory/admin/maintenance/amc", "/ivr", "/ivr/admin", "/login", "/payment-desk"].map(hubDarkAllowed), Array(11).fill(true));
  eq("hub dark: Attendance (its own dark mode) and the modules with their own look keep theirs, with or without a query; /attendancex is not Attendance",
    ["/attendance", "/attendance/more/profile", "/attendance?tab=x", "/aistudio/admin", "/design", "/design/admin/board", "/eru/documents/1", "/cabs", "/cabs/driver", "/cabs/admin", "/review/abcdefghijklmnopqrstuvwxyz", "/track/DF-0001"].map(hubDarkAllowed), Array(12).fill(false));
  eq("hub dark: only the exact first path segment counts", ["/attendancex", "/designs", "/erus", "/?next=/attendance", "/administrator/attendance"].map(hubDarkAllowed), Array(5).fill(true));
  eq("hub dark: Attendance is always among the pages left alone", HUB_DARK_EXCLUDED.includes("/attendance"), true);
  eq("hub dark: a saved choice wins over the device; with none the device decides; junk saved counts as none",
    [isHubDark("dark", false), isHubDark("light", true), isHubDark(null, true), isHubDark(null, false), parseHubThemePref("dark"), parseHubThemePref("light"), parseHubThemePref("purple"), parseHubThemePref(null), parseHubThemePref(undefined)],
    [true, false, true, false, "dark", "light", null, null, null]);

  // The first-paint script
  eq("hub dark first paint: a saved dark choice puts hub-dark on a hub page before it paints", firstPaint("/administrator", "dark", false), ["hub-dark"]);
  eq("hub dark first paint: with no choice, a dark device gets it and a light device does not", [firstPaint("/", null, true), firstPaint("/", null, false)], [["hub-dark"], []]);
  eq("hub dark first paint: a saved light choice beats a dark device", firstPaint("/", "light", true), []);
  eq("hub dark first paint: never on Attendance or a module with its own look, even when dark is saved", ["/attendance", "/attendance/admin/settings", "/design/admin", "/eru", "/aistudio", "/cabs/driver"].map((p) => firstPaint(p, "dark", true)), Array(6).fill([]));
  eq("hub dark first paint: a browser that blocks storage falls back to nothing, without an error (and the device setting is not consulted)", firstPaint("/", "dark", true, true), []);
  // Dropdowns in dark mode (src/app/globals.css): a #111111 panel with #F5F5F5 text, #1A1A1A under the row the pointer is on, the primary teal under the
  // chosen row, a dark search box and a dark scrollbar, for the Approval System's searchable dropdown, the people picker and the icon picker.
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((x) => x.trim()), body: m[2] }));
  const bodyOf = (selector: string) => rules.filter((r) => r.selectors.includes(selector)).map((r) => r.body).join(" ");
  const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
  const APR = "html.hub-dark .apr-root";
  eq("dark dropdowns: the colours are #111111 panel, #F5F5F5 text, #1A1A1A hover, the primary teal for the chosen row, and a darker search box",
    ["--dd-bg", "--dd-text", "--dd-hover", "--dd-selected", "--dd-search-bg"].map(token), ["#111111", "#f5f5f5", "#1a1a1a", "var(--c-primary)", "#0a0a0a"]);
  eq("dark dropdowns: the Approval System's dropdown panel (white in light mode) gets the dark panel, light text and a dark scrollbar",
    [`${APR} .zd-pop`, `${APR} .zd-list`].map((s) => bodyOf(s)).map((b) => [b.includes("var(--dd-bg)"), b.includes("var(--dd-text)") || b.includes("scrollbar-color")]), [[true, true], [true, true]]);
  eq("dark dropdowns: the hovered row, the chosen row and the search box each have their own dark colour",
    [bodyOf(`${APR} .zd-opt[data-hot="true"]`).includes("background: var(--dd-hover)"), bodyOf(`${APR} .zd-opt[aria-selected="true"]`).includes("background: var(--dd-selected)"), bodyOf(`${APR} .zd-search input`).includes("background: var(--dd-search-bg)")],
    [true, true, true]);
  eq("dark dropdowns: the chosen row has white text and the hovered row light text (neither is left to the light-mode colours)",
    [bodyOf(`${APR} .zd-opt[aria-selected="true"]`).includes("color: var(--dd-selected-text)"), bodyOf(`${APR} .zd-opt[data-hot="true"]`).includes("color: var(--dd-text)")], [true, true]);
  eq("dark mode: a primary button's text is a fixed white, not the surface token (which is near-black in dark mode: black on teal)",
    [/color:\s*#fff(fff)?\b/.test(bodyOf(".btn-primary")), /(^|[;\s])color:\s*var\(--c-white\)/.test(bodyOf(".btn-primary"))], [true, false]);
  eq("dark dropdowns: the people picker marks its active row (data-active) so dark mode can colour it, and the browser's own option lists get the dark colours",
    [readFileSync(new URL("../src/components/ivr/admin/agent-picker.tsx", import.meta.url), "utf8").includes("data-active={i === active}"), bodyOf("html.hub-dark option").includes("background-color: var(--dd-bg)")], [true, true]);
}
