/** Small browser checks for the installable app, pure so they can be tested. */

/** iPhone or iPad Safari (not Chrome, Firefox, Edge or Opera on iOS), which has no install prompt: people add it from the Share menu. */
export const isIosSafari = (ua: string) => /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
