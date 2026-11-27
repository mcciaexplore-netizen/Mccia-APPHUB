"use client";

import { useState } from "react";
import { initialsOf } from "@/lib/avatar-rules";

/**
 * A person's round profile photo, or their initials when they have none ("AS" for AI Studio), or when the picture cannot be loaded (so a
 * missing file never shows as a broken image). Round, `size` pixels across. The name is shown next to it wherever it is used, so the
 * picture itself is hidden from screen readers.
 */
export function Avatar({ name, src, size = 36, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  // The address that failed to load: a new photo (a new address) gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a public Supabase Storage address, not a static asset
      <img src={src} alt="" aria-hidden width={size} height={size} style={style} className={`inline-block shrink-0 rounded-full border border-line bg-alt object-cover ${className}`} onError={() => setFailed(src)} />
    );
  }
  return (
    <span aria-hidden style={style} className={`inline-grid shrink-0 select-none place-items-center rounded-full border border-blue-tint-line bg-blue-tint font-bold leading-none text-primary ${className}`}>
      {initialsOf(name)}
    </span>
  );
}
