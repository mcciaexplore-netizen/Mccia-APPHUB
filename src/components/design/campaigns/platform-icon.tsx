import { AtSign, Briefcase, Camera, CirclePlay, Globe, MessageCircle, ThumbsUp, type LucideIcon } from "lucide-react";

/** A plain icon per platform (the icon set has no brand logos), with the platform's name for screen readers. */
const ICONS: Record<string, LucideIcon> = { Instagram: Camera, Facebook: ThumbsUp, LinkedIn: Briefcase, WhatsApp: MessageCircle, X: AtSign, YouTube: CirclePlay };

export function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  const Icon = ICONS[platform] ?? Globe;
  return <Icon size={size} aria-label={platform} className="shrink-0 text-[var(--ds-navy)]" />;
}
