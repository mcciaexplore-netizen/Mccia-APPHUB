import { createElement } from "react";
import { iconFor } from "@/lib/icons";

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return createElement(iconFor(name), { size, className, "aria-hidden": true });
}
