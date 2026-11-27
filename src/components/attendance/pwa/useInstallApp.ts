"use client";

import { useCallback, useSyncExternalStore } from "react";
import { installState, isIosSafari, type InstallState } from "@/lib/attendance/pwa-rules";

/** The browser's install offer (Chrome, Edge, Android). Not in the standard DOM types yet. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Win = Window & { __mcciaInstall?: InstallEvent };

/**
 * Whether, and how, MCCIA People can be installed from this browser, for the "Install App" button. The browser's offer (the
 * beforeinstallprompt event) is caught by a script in the page head, because it can arrive before this code runs, and handed over here as
 * window.__mcciaInstall. See installState (src/lib/attendance/pwa-rules.ts) for the states.
 *
 * Read with useSyncExternalStore, so the server and the first browser render agree ("unavailable": no button) and the button appears once the
 * browser has said what it can do.
 */

const CHANGED = "att-install-changed";
// Remembered for this page view: the app was installed from here, or the one-time offer was turned down.
let installedNow = false;
let declined = false;

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const snapshot = (): InstallState =>
  installState({ standalone: standalone(), installedNow, hasOffer: !!(window as Win).__mcciaInstall, ios: isIosSafari(navigator.userAgent), declined });

function subscribe(onChange: () => void) {
  const onInstalled = () => {
    installedNow = true;
    (window as Win).__mcciaInstall = undefined;
    onChange();
  };
  window.addEventListener("mccia-install-ready", onChange);
  window.addEventListener("appinstalled", onInstalled);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("mccia-install-ready", onChange);
    window.removeEventListener("appinstalled", onInstalled);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useInstallApp(): { state: InstallState; install: () => Promise<void> } {
  const state = useSyncExternalStore<InstallState>(subscribe, snapshot, () => "unavailable");
  // The browser's own install box. It can be used once: after it, the offer is gone until the browser makes another.
  const install = useCallback(async () => {
    const offer = (window as Win).__mcciaInstall;
    if (!offer) return;
    try {
      await offer.prompt();
      const { outcome } = await offer.userChoice;
      if (outcome === "accepted") installedNow = true;
      else declined = true;
    } catch {
      declined = true;
    }
    (window as Win).__mcciaInstall = undefined;
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { state, install };
}
