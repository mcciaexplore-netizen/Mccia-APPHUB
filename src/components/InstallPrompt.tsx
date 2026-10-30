"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, X } from "lucide-react";
import { Modal } from "@/components/Modal";

/** The browser's install offer (Chrome, Edge, Android). Not in the standard DOM types yet. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const SEEN = "mccia-install-popup-seen";
const SNOOZE = "mccia-install-snoozed-until";
const WEEK = 7 * 86400000;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window: it simply asks again */ } };

/**
 * Offers the hub as an app to download. The first time someone opens it: a popup. After that: a small notification at the bottom, which
 * "Not now" hides for a week. Nothing shows once it is installed (opened as the app). Where the browser cannot install by itself (iPhone
 * Safari, Firefox), it says how to add it by hand.
 */
export function InstallPrompt() {
  const [offer, setOffer] = useState<InstallEvent | null>(null);
  const [show, setShow] = useState<"popup" | "banner" | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) return;
    // The offer is caught by a script in the page head (it can arrive before this runs), then handed over here.
    const w = window as Window & { __mcciaInstall?: InstallEvent };
    const onOffer = () => { if (w.__mcciaInstall) setOffer(w.__mcciaInstall); };
    const onInstalled = () => { setShow(null); setOffer(null); w.__mcciaInstall = undefined; };
    onOffer();
    window.addEventListener("mccia-install-ready", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    // Shown after a moment, so it never covers the page while it is still loading.
    const t = setTimeout(() => {
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
      if (!read(SEEN)) setShow("popup");
      else if (Number(read(SNOOZE) ?? 0) < Date.now()) setShow("banner");
    }, 1500);
    return () => { clearTimeout(t); window.removeEventListener("mccia-install-ready", onOffer); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  const close = (snooze: boolean) => {
    write(SEEN, "1");
    if (snooze) write(SNOOZE, String(Date.now() + WEEK));
    setShow(null);
  };
  // The browser's own Install box when it has offered one (it can be used once; the browser offers again later). Otherwise the steps.
  const install = async () => {
    if (!offer) { setShow("popup"); return; }
    try {
      await offer.prompt();
      const { outcome } = await offer.userChoice;
      (window as Window & { __mcciaInstall?: InstallEvent }).__mcciaInstall = undefined;
      setOffer(null);
      if (outcome === "accepted") close(false);
      else setShow("popup");
    } catch {
      setOffer(null);
      setShow("popup");
    }
  };

  const how = offer ? null : ios
    ? <>On iPhone or iPad: tap <b>Share</b> (the square with an arrow) in Safari, then <b>Add to Home Screen</b>.</>
    : <>In Chrome or Edge: click the <b>install icon</b> at the right of the address bar, or open the browser menu (⋮) and choose <b>Install MCCIA App Hub</b> (on a phone: <b>Add to Home screen</b>).</>;

  if (show === "popup") {
    return (
      <Modal title="Download the MCCIA App Hub" onClose={() => close(true)}>
        <div className="flex items-start gap-4">
          <Image src="/icon-192.png" alt="" width={56} height={56} className="rounded-[12px] border border-line" />
          <div className="space-y-2 text-sm text-muted">
            <p>Install the App Hub on this computer or phone. It opens in its own window from your desktop or home screen, like any other app, and always has the latest version.</p>
            {how && <p>{how}</p>}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => close(true)}>Not now</button>
          {offer ? <button className="btn btn-primary btn-sm" onClick={install}><Download size={14} /> Download the app</button>
            : <button className="btn btn-primary btn-sm" onClick={() => close(false)}>Got it</button>}
        </div>
      </Modal>
    );
  }
  if (show === "banner") {
    return (
      <div role="status" className="fixed inset-x-3 bottom-3 z-[80] mx-auto flex max-w-xl animate-rise items-center gap-3 rounded-md border border-line bg-white p-3 shadow-card sm:inset-x-auto sm:right-4">
        <Image src="/icon-192.png" alt="" width={36} height={36} className="rounded-[8px] border border-line" />
        <p className="min-w-0 flex-1 text-sm"><b className="text-ink">Download this application</b><span className="block text-xs text-muted">{offer ? "Install the App Hub on this device." : ios ? "Share → Add to Home Screen." : "Browser menu → Install MCCIA App Hub."}</span></p>
        <button className="btn btn-primary btn-sm" onClick={install}><Download size={14} /> {offer ? "Install" : "How to install"}</button>
        <button className="btn btn-ghost btn-sm" aria-label="Not now" onClick={() => close(true)}><X size={14} /></button>
      </div>
    );
  }
  return null;
}
