"use client";

import type { CabRole } from "@/lib/cabs/cabs.manifest";
import { SectionSidebar } from "./SectionSidebar";

/** The sidebar of Cabs Driver. */
export function CabsDriverSidebar({ roles }: { roles: CabRole[] }) {
  return <SectionSidebar section="driver" roles={roles} />;
}
