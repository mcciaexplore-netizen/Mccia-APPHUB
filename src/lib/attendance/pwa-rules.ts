/** Small browser checks for the installable app, pure so they can be tested. */

/** iPhone or iPad Safari (not Chrome, Firefox, Edge or Opera on iOS), which has no install prompt: people add it from the Share menu. */
export const isIosSafari = (ua: string) => /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

/** Dark mode: the person's own choice ("light" / "dark", kept on the device), or none, which follows the device's setting. */
export type ThemePref = "light" | "dark" | null;
export const parseThemePref = (raw: unknown): ThemePref => (raw === "light" || raw === "dark" ? raw : null);
export const isDarkTheme = (pref: ThemePref, systemDark: boolean) => (pref ? pref === "dark" : systemDark);
/** The browser bar's colour: pure black in dark mode, the green otherwise. */
export const themeColorFor = (dark: boolean) => (dark ? "#000000" : "#16A34A");
