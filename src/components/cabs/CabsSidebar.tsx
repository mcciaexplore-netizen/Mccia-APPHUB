"use client";

import type { CabRole } from "@/lib/cabs/cabs.manifest";
import { SectionSidebar } from "./SectionSidebar";

/** The sidebar of MCCIA Cabs (book and follow rides). */
export function CabsSidebar({ roles }: { roles: CabRole[] }) {
  return <SectionSidebar section="staff" roles={roles} />;
}
