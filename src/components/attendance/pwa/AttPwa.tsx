"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, WifiOff, X } from "lucide-react";
import { isIosSafari } from "@/lib/attendance/pwa-rules";

/**
 * "MCCIA People" as an app: registers Attendance's service worker (scope /attendance) and tells it who is signed in (it clears kept pages when
 * someone else signs in on the device), shows an offline banner, and offers to install the app on a phone.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Win = Window & { __mcciaInstall?: InstallEvent };

const DISMISSED = "att-install-dismissed-until";
const WEEK = 7 * 86_400_000;
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private window: it simply offers again
  }
};

/** Whether the browser is online, kept up to date (true on the server). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}


export function AttPwa({ userId }: { userId: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/attendance-sw.js", { scope: "/attendance" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => reg.active?.postMessage({ type: "user", id: userId }))
      .catch(() => {});
  }, [userId]);
  return (
    <>
      <OfflineBanner />
      <InstallBanner />
    </>
  );
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="att-offline">
      <WifiOff size={16} aria-hidden /> You are offline. Showing the last saved data; a check-in or check-out is sent when you reconnect.
    </div>
  );
}

/**
 * On a phone, the first visit (and again a week after "Later"): a green banner at the bottom. Android Chrome and Edge: the browser's own
 * Install. iPhone Safari: how to add it from the Share menu. Nothing once the app is installed (opened from the home screen).
 */
function InstallBanner() {
  const [show, setShow] = useState<null | "install" | "ios" | "menu">(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if (standalone || !phone) return;
    if (Number(read(DISMISSED) ?? 0) > Date.now()) return;
    const pick = () => setShow((window as Win).__mcciaInstall ? "install" : isIosSafari(navigator.userAgent) ? "ios" : "menu");
    const onInstalled = () => {
      write(DISMISSED, String(Date.now() + 3650 * 86_400_000));
      setShow(null);
    };
    // After a moment, so it never covers the page while it loads; the install offer may arrive a little later.
    const t = setTimeout(pick, 1500);
    window.addEventListener("mccia-install-ready", pick);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mccia-install-ready", pick);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (!show) return null;

  const later = () => {
    write(DISMISSED, String(Date.now() + WEEK));
    setShow(null);
  };
  const install = async () => {
    const offer = (window as Win).__mcciaInstall;
    if (!offer) return setShow(isIosSafari(navigator.userAgent) ? "ios" : "menu");
    try {
      await offer.prompt();
      const { outcome } = await offer.userChoice;
      (window as Win).__mcciaInstall = undefined;
      if (outcome === "accepted") {
        write(DISMISSED, String(Date.now() + 3650 * 86_400_000));
        setShow(null);
      } else later();
    } catch {
      setShow("menu");
    }
  };

  return (
    <div className="att-install" role="dialog" aria-label="Install MCCIA People">
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] font-bold">📱 Install MCCIA People for quick check-in</p>
        {show === "ios" && (
          <p className="mt-0.5 text-[0.8rem] text-white/90">
            Tap <Share size={13} className="inline -mt-0.5" aria-label="Share" /> Share, then <b>Add to Home Screen</b>.
          </p>
        )}
        {show === "menu" && <p className="mt-0.5 text-[0.8rem] text-white/90">Open the browser menu (⋮), then <b>Add to Home screen</b> or <b>Install app</b>.</p>}
      </div>
      {show === "install" && (
        <button type="button" className="att-install-btn" onClick={install}>
          Install
        </button>
      )}
      <button type="button" className="att-install-later" onClick={later} aria-label="Later">
        {show === "install" ? "Later" : <X size={18} aria-hidden />}
      </button>
    </div>
  );
}
