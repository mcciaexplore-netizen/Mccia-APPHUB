"use client";

import type { CabRole } from "@/lib/cabs/cabs.manifest";
import { SectionSidebar } from "./SectionSidebar";

/** The sidebar of Cabs Admin. */
export function CabsAdminSidebar({ roles }: { roles: CabRole[] }) {
  return <SectionSidebar section="admin" roles={roles} />;
}
