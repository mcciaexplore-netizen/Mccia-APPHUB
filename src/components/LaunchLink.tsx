"use client";

import Link from "next/link";

/**
 * Opens an application built into the hub (Cab Booking, Inventory: its address is a page of this site) without reloading the page, and
 * records the launch in the background: POST /go/<id> runs the same checks as opening it through /go and writes the same activity row.
 * The page itself still checks access on its own, so nothing here grants anything.
 */
export function LaunchLink({ appId, href, title, style, className, children }: {
  appId: string; href: string; title?: string; style?: React.CSSProperties; className?: string; children: React.ReactNode;
}) {
  const record = () => {
    try {
      if (!navigator.sendBeacon?.(`/go/${appId}`)) void fetch(`/go/${appId}`, { method: "POST", keepalive: true }).catch(() => {});
    } catch {}
  };
  return <Link href={href} title={title} style={style} className={className} onClick={record}>{children}</Link>;
}
