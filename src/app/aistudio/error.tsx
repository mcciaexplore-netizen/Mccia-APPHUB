"use client";

import { SectionError } from "@/components/SectionError";

/** Any AI Studio page that fails where its section's own frame cannot be shown (a page outside the sections, or a section's layout failing): this, not a blank screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <SectionError error={error} retry={retry} home="/" homeLabel="App Hub" />;
}
