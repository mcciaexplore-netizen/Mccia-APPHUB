"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { isDarkTheme, parseThemePref, themeColorFor, type ThemePref } from "@/lib/attendance/pwa-rules";

/**
 * Dark mode for Attendance (MCCIA People). The person's choice is kept on this device (localStorage "att-theme": "light" or "dark");
 * without one it follows the device's setting (prefers-color-scheme). Dark mode is the class att-dark on <html>, set:
 *   - before the first paint, by THEME_SCRIPT (in the Attendance layout), so a dark page never flashes white;
 *   - then by ThemeController, which follows the choice and the device setting as they change, and removes the class when the person leaves
 *     Attendance for a hub page (the hub has no dark mode).
 */

export const THEME_KEY = "att-theme";
const EVENT = "att-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("${DARK_QUERY}").matches);if(d)document.documentElement.classList.add("att-dark")}catch(e){}})();`;

const readPref = (): ThemePref => {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return null;
  }
};

/** Saves the choice (null: follow the device again) and applies it at once. */
export function setThemePref(pref: ThemePref): void {
  try {
    if (pref) localStorage.setItem(THEME_KEY, pref);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // private window: it still applies until the page is closed
  }
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

/** The choice and whether the page is dark, kept up to date (light on the server: the first-paint script corrects it). */
export function useTheme(): { pref: ThemePref; dark: boolean; systemDark: boolean } {
  const snap = useSyncExternalStore(
    subscribe,
    () => `${readPref() ?? "system"}|${window.matchMedia(DARK_QUERY).matches ? 1 : 0}`,
    () => "system|0",
  );
  const [p, sys] = snap.split("|");
  const pref = parseThemePref(p);
  const systemDark = sys === "1";
  return { pref, dark: isDarkTheme(pref, systemDark), systemDark };
}

/** Keeps <html class="att-dark"> and the browser bar's colour in step; undoes both when Attendance is left. */
export function ThemeController() {
  const { pref, dark } = useTheme();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("att-dark", dark);
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    for (const m of metas) {
      if (!m.dataset.attOriginal) m.dataset.attOriginal = m.content;
      // A choice made in Profile wins over the device's setting (which the metas' media queries already follow).
      m.content = pref ? themeColorFor(dark) : m.dataset.attOriginal;
    }
    return () => {
      root.classList.remove("att-dark");
      for (const m of metas) if (m.dataset.attOriginal) m.content = m.dataset.attOriginal;
    };
  }, [pref, dark]);
  return null;
}
