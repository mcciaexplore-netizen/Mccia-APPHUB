/** Small browser checks for the installable app, pure so they can be tested. */

/** iPhone or iPad Safari (not Chrome, Firefox, Edge or Opera on iOS), which has no install prompt: people add it from the Share menu. */
export const isIosSafari = (ua: string) => /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

/**
 * What the "Install App" button in MCCIA People shows, from what the browser has said:
 *   installed    opened as the app, or just installed: no button
 *   ready        the browser offered its install box (Chrome, Edge, Android): the button opens it
 *   ios          iPhone/iPad Safari, which has no install box: the button shows "Share, then Add to Home Screen"
 *   manual       the offer was used and turned down: the browser will not offer it again for a while, so the button shows the menu steps
 *   unavailable  the browser has offered nothing (Firefox, desktop Safari, or not installable): no button
 */
export type InstallState = "installed" | "ready" | "ios" | "manual" | "unavailable";
export function installState(i: { standalone: boolean; installedNow: boolean; hasOffer: boolean; ios: boolean; declined: boolean }): InstallState {
  if (i.standalone || i.installedNow) return "installed";
  if (i.hasOffer) return "ready";
  if (i.ios) return "ios";
  if (i.declined) return "manual";
  return "unavailable";
}

/** Dark mode: the person's own choice ("light" / "dark", kept on the device), or none, which follows the device's setting. */
export type ThemePref = "light" | "dark" | null;
export const parseThemePref = (raw: unknown): ThemePref => (raw === "light" || raw === "dark" ? raw : null);
export const isDarkTheme = (pref: ThemePref, systemDark: boolean) => (pref ? pref === "dark" : systemDark);
/** The browser bar's colour: pure black in dark mode, the green otherwise. */
export const themeColorFor = (dark: boolean) => (dark ? "#000000" : "#16A34A");
