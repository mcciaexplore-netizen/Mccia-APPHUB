/**
 * Dark mode for the App Hub, the rules (no server-only imports: the page's first-paint script, the controller and the unit tests share them).
 *
 * The person's choice is kept on this device (localStorage "hub-theme": "light" or "dark"); without one, the device's own setting is followed
 * (prefers-color-scheme). Dark mode is the class hub-dark on <html>; src/app/globals.css swaps the hub's colour tokens under it.
 */

export type HubThemePref = "light" | "dark" | null;
export const HUB_THEME_KEY = "hub-theme";
export const parseHubThemePref = (raw: unknown): HubThemePref => (raw === "light" || raw === "dark" ? raw : null);
/** Dark when the person chose it, or has chosen nothing and the device is dark. */
export const isHubDark = (pref: HubThemePref, systemDark: boolean) => (pref ? pref === "dark" : systemDark);

/**
 * The pages that keep their own look, where the hub's dark mode is never applied (nor offered in the menu):
 *   /attendance   MCCIA People has its own dark mode (Profile > Appearance), kept apart from the hub's
 *   /aistudio, /design, /eru, and DesignDesk's public /review and /track pages
 *                 each has its own design system with white cards written into its stylesheet; on the hub's dark colours their text
 *                 would be light on white. They can adopt dark mode when their own styles do.
 * /cabs      Cab Booking's rider and driver screens are an app of their own, with colours written into their markup
 * Every other page (the home page, Administrator, notifications, Approval System, Inventory, IVR-CRM ...) is built on the hub's colour
 * tokens and follows the choice.
 */
export const HUB_DARK_EXCLUDED = ["/attendance", "/aistudio", "/design", "/eru", "/cabs", "/review", "/track"] as const;

export const HUB_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in the page's head before anything is painted (the root layout puts it there): dark mode is on from the first frame, so a dark page
 * never flashes white. It does what HubThemeController does, once: nothing on the pages that keep their own look, else dark when the choice
 * is dark, or when there is no choice and the device is dark.
 */
export const HUB_THEME_SCRIPT = `(function(){try{var x=${JSON.stringify(HUB_DARK_EXCLUDED)},p=location.pathname;for(var i=0;i<x.length;i++)if(p===x[i]||p.indexOf(x[i]+"/")===0)return;var t=localStorage.getItem("${HUB_THEME_KEY}");if(t==="dark"||(t!=="light"&&window.matchMedia("${HUB_DARK_QUERY}").matches))document.documentElement.classList.add("hub-dark")}catch(e){}})();`;

/** Whether the hub's dark mode applies on this page (an address, with or without a query). */
export function hubDarkAllowed(pathname: string): boolean {
  const p = pathname.split(/[?#]/)[0];
  return !HUB_DARK_EXCLUDED.some((x) => p === x || p.startsWith(`${x}/`));
}
