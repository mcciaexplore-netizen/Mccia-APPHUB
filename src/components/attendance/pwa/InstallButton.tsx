"use client";

import { useState } from "react";
import { Download, Share } from "lucide-react";
import { Card } from "../ui";
import { useInstallApp } from "./useInstallApp";

/**
 * The green "Install App" button of MCCIA People, the only place the app offers to be installed on a laptop (the App Hub itself offers
 * nothing). It shows only when the browser can install the app, and goes away once it is installed (or opened as the app):
 *   Chrome, Edge, Android   the click opens the browser's own install box
 *   iPhone and iPad Safari  there is no install box: the click shows "Share, then Add to Home Screen"
 *   after the box was turned down  the click shows where the browser menu has it
 * "side": a button at the bottom of the sidebar (laptop). "card": a card for the Profile page, on a phone only (the sidebar is not there).
 */
export function InstallButton({ variant = "side" }: { variant?: "side" | "card" }) {
  const { state, install } = useInstallApp();
  const [help, setHelp] = useState(false);
  if (state === "unavailable" || state === "installed") return null;

  const steps =
    state === "ios" ? (
      <>
        Tap <Share size={13} className="-mt-0.5 inline" aria-label="Share" /> <b>Share</b> in Safari, then <b>Add to Home Screen</b>.
      </>
    ) : (
      <>
        Open the browser menu (⋮), then choose <b>Install app</b> or <b>Add to Home screen</b>.
      </>
    );
  const button = (
    <button type="button" className="att-install-app" aria-expanded={state === "ready" ? undefined : help} onClick={() => (state === "ready" ? void install() : setHelp((h) => !h))}>
      <Download size={16} aria-hidden /> Install App
    </button>
  );
  const note = state !== "ready" && help && (
    <p role="status" className="mt-2 text-[0.8rem] leading-snug text-(--att-text-2)">
      {steps}
    </p>
  );

  if (variant === "side")
    return (
      <div className="relative z-10 mt-5 px-1">
        {button}
        {note}
      </div>
    );
  return (
    <Card title="Install the app" subtitle="MCCIA People opens from your home screen, like any other app." icon={Download} iconTone="green" className="md:hidden">
      {button}
      {note}
    </Card>
  );
}
