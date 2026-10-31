"use client";

import type { CabRole } from "@/lib/cabs/cabs.manifest";
import { SectionSidebar } from "./SectionSidebar";

/** The sidebar of Cabs Admin, with its badges (worked out on each page load). */
export function CabsAdminSidebar({ roles, badges }: { roles: CabRole[]; badges: { live: number; pending: number; loginRequests: number } }) {
  return <SectionSidebar section="admin" roles={roles} {...badges} />;
}
