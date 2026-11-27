"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { HUB_DARK_QUERY as DARK_QUERY, HUB_THEME_KEY, hubDarkAllowed, isHubDark, parseHubThemePref, type HubThemePref } from "@/lib/hub-theme-rules";

/**
 * Dark mode for the App Hub (rules and the list of pages that keep their own look: src/lib/hub-theme-rules.ts). Dark mode is the class
 * hub-dark on <html>, set:
 *   - before the first paint, by HUB_THEME_SCRIPT (src/lib/hub-theme-rules.ts, in the root layout's head), so a dark page never flashes white;
 *   - then by HubThemeController, which follows the choice and the device's setting as they change, and takes the class off on the pages
 *     that keep their own look (Attendance has its own dark mode, so it is never both) and puts it back when the person returns.
 */

const EVENT = "hub-theme-change";
const readPref = (): HubThemePref => {
  try {
    return parseHubThemePref(localStorage.getItem(HUB_THEME_KEY));
  } catch {
    return null;
  }
};

/** Saves the choice (null: follow the device again) and applies it at once, fading the colours over 0.2 s. */
export function setHubThemePref(pref: HubThemePref): void {
  try {
    if (pref) localStorage.setItem(HUB_THEME_KEY, pref);
    else localStorage.removeItem(HUB_THEME_KEY);
  } catch {
    // private window: it still applies until the page is closed
  }
  const root = document.documentElement;
  // The fade is only on while the colours change, so it never slows the page or plays on first paint.
  root.classList.add("hub-theme-fade");
  window.setTimeout(() => root.classList.remove("hub-theme-fade"), 300);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  mq.addEventListener("change", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
    mq.removeEventListener("change", cb);
  };
}

/** The choice and whether the hub is dark, kept up to date (light on the server: the first-paint script corrects it). */
export function useHubTheme(): { pref: HubThemePref; dark: boolean; systemDark: boolean } {
  const snap = useSyncExternalStore(
    subscribe,
    () => `${readPref() ?? "system"}|${window.matchMedia(DARK_QUERY).matches ? 1 : 0}`,
    () => "system|0",
  );
  const [p, sys] = snap.split("|");
  const pref = parseHubThemePref(p);
  const systemDark = sys === "1";
  return { pref, dark: isHubDark(pref, systemDark), systemDark };
}

/** Keeps <html class="hub-dark"> in step with the choice, the device setting and the page open. Draws nothing. */
export function HubThemeController() {
  const { dark } = useHubTheme();
  const pathname = usePathname();
  const on = dark && hubDarkAllowed(pathname);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("hub-dark", on);
  }, [on]);
  return null;
}
