"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { subscribePushAction, unsubscribePushAction } from "@/lib/attendance/actions/staff";
import { b64urlToBytes } from "@/lib/attendance/push-rules";
import { Card } from "../ui";
import { useAct } from "../use-act";
import { isIosSafari } from "@/lib/attendance/pwa-rules";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/**
 * Phone notifications for this device (Web Push): check-in and check-out reminders, decisions on requests, leave approvals. Shown only when
 * the server has push keys. On an iPhone they work only once MCCIA People is on the home screen (Apple's rule), so it says so first.
 */
export function NotificationsCard({ vapidKey, reminders }: { vapidKey: string; reminders: { checkIn: string; checkOut: string } | null }) {
  const { act, pending } = useAct();
  const [state, setState] = useState<State>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    let live = true;
    const set = (s: State) => live && setState(s);
    if (!supported) {
      queueMicrotask(() => set(isIosSafari(navigator.userAgent) && !standalone ? "ios-install" : "unsupported"));
    } else if (Notification.permission === "denied") {
      queueMicrotask(() => set("denied"));
    } else {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (!live) return;
          setEndpoint(sub?.endpoint ?? null);
          setState(sub ? "on" : "off");
        })
        .catch(() => set("unsupported"));
    }
    return () => {
      live = false;
    };
  }, []);

  const turnOn = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(vapidKey) as BufferSource });
      const r = await act(() => subscribePushAction(sub.toJSON()), { noRefresh: true });
      if (r.ok) {
        setEndpoint(sub.endpoint);
        setState("on");
      } else await sub.unsubscribe();
    } catch {
      setState("off");
    }
  };
  const turnOff = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
      if (endpoint) await act(() => unsubscribePushAction(endpoint), { noRefresh: true });
    } finally {
      setEndpoint(null);
      setState("off");
    }
  };

  const text: Record<State, string> = {
    loading: "Checking this device…",
    unsupported: "This browser cannot show notifications. The bell in the App Hub still has everything.",
    "ios-install": "On an iPhone, notifications work once MCCIA People is on your home screen: tap Share, then Add to Home Screen, open it from there, and come back here.",
    denied: "Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.",
    off: `${reminders ? `Get reminders to check in (${reminders.checkIn}) and check out (${reminders.checkOut}), and hear` : "Hear"} at once when a request is approved or rejected.`,
    on: "On for this device: reminders and decisions arrive as notifications.",
  };
  return (
    <Card title="Notifications on this device" icon={Bell} iconTone="green">
      <div id="notifications" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">{text[state]}</p>
        {state === "off" && (
          <button type="button" className="btn btn-primary w-full shrink-0 sm:w-auto" disabled={pending} onClick={turnOn}>
            Turn on
          </button>
        )}
        {state === "on" && (
          <button type="button" className="btn btn-ghost w-full shrink-0 sm:w-auto" disabled={pending} onClick={turnOff}>
            Turn off
          </button>
        )}
      </div>
    </Card>
  );
}
