"use client";

import { SectionError } from "@/components/SectionError";

/** A page here that fails shows this inside the App Hub frame (its menu stays), not a blank screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <SectionError error={error} retry={retry} home="/" homeLabel="App Hub home" />;
}
