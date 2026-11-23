"use client";

import { SectionError } from "@/components/SectionError";

/** A page here that fails shows this inside the DesignDesk Admin frame (its menu stays), not a blank screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <SectionError error={error} retry={retry} home="/design/admin" homeLabel="DesignDesk Admin home" />;
}
