"use client";

import { useState } from "react";
import { Play } from "lucide-react";

/**
 * A recording is only requested when someone presses play, so a list with many calls does not download or decode anything up front.
 * Until then the button shows the call length we already know, so the duration is never blank or 0:00.
 */
export function RecordingPlayer({ callId, duration, className = "" }: { callId: string; duration: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return <audio className={`h-9 w-full ${className}`} controls autoPlay preload="auto" src={`/api/ivr/recordings/${callId}`} />;
  }
  return (
    <button type="button" className={`btn btn-ghost btn-sm gap-2 ${className}`} onClick={() => setOpen(true)} aria-label={`Play recording, ${duration}`}>
      <Play className="h-3.5 w-3.5" aria-hidden />
      Play recording
      <span className="tabular-nums text-subtle">{duration}</span>
    </button>
  );
}
