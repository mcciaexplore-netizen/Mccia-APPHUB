"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { logout } from "@/actions/auth";
import { Avatar } from "@/components/Avatar";
import { setHubThemePref, useHubTheme } from "@/components/HubTheme";
import { ProfileDialog } from "@/components/ProfileDialog";
import { roleLabel } from "@/lib/format";
import { hubDarkAllowed } from "@/lib/hub-theme-rules";

const item = "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-muted transition-colors hover:bg-blue-tint hover:text-primary";

/**
 * The person's menu at the right of the top bar: their photo (or initials) and name, and under them a card with the photo, name, email and
 * role, then Edit Profile (the photo), the Dark mode switch, Change password and Sign out. Clicking the photo in the card is the same as
 * Edit Profile. The switch is for the hub's own pages: on the pages that keep their own look it is shown but off-limits, with the reason.
 */
export function UserMenu({ name, email, role, avatarUrl }: { name: string; email: string; role: keyof typeof roleLabel; avatarUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // A photo just saved shows at once; once the page has reloaded with it, the address from the server is the same and takes over.
  const [saved, setSaved] = useState<{ from: string | null; url: string | null } | null>(null);
  const photo = saved && saved.from === avatarUrl ? saved.url : avatarUrl;
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { dark } = useHubTheme();
  const themeAllowed = hubDarkAllowed(pathname);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, []);

  const edit = () => { setOpen(false); setEditing(true); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={`${name}, account menu`}
        className="flex items-center gap-2 text-sm font-medium text-ink transition-colors hover:text-primary">
        <Avatar name={name} src={photo} size={36} />
        <span className="max-w-28 truncate sm:max-w-40">{name}</span><ChevronDown size={14} className="text-subtle" />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-full z-50 mt-3 w-72 max-w-[calc(100vw-1.5rem)] animate-pop !rounded-md !bg-(--c-white) p-2">
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <button type="button" onClick={edit} aria-label="Change profile photo" title="Change profile photo" className="shrink-0 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <Avatar name={name} src={photo} size={40} />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{name}</p>
              {email && <p className="truncate text-xs text-muted">{email}</p>}
              <span className="badge mt-1">{roleLabel[role]}</span>
            </div>
          </div>
          <div className="border-t border-line pt-1">
            <button role="menuitem" className={item} onClick={edit}><UserRound size={15} /> Edit Profile</button>
            <div className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-muted">
              {dark && themeAllowed ? <Moon size={15} /> : <Sun size={15} />}
              <span className="min-w-0 flex-1">
                Dark mode
                {!themeAllowed && <span className="block text-xs text-subtle">Not available on this page</span>}
              </span>
              <button type="button" role="switch" aria-checked={dark && themeAllowed} aria-label="Dark mode" disabled={!themeAllowed}
                onClick={() => setHubThemePref(dark ? "light" : "dark")}
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dark && themeAllowed ? "border-primary bg-primary" : "border-line bg-alt"}`}>
                <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full text-primary shadow transition-transform ${dark && themeAllowed ? "translate-x-[1.3rem] bg-[#ffffff]" : "translate-x-0.5 bg-(--c-white)"}`}>
                  {dark && themeAllowed ? <Moon size={11} /> : <Sun size={11} />}
                </span>
              </button>
            </div>
            <Link href="/change-password" role="menuitem" className={item}><KeyRound size={15} /> Change password</Link>
            <form action={logout}>
              <button role="menuitem" className={item}><LogOut size={15} /> Sign out</button>
            </form>
          </div>
        </div>
      )}
      {editing && <ProfileDialog name={name} email={email} avatarUrl={photo} onClose={() => setEditing(false)} onChanged={(url) => setSaved({ from: avatarUrl, url })} />}
    </div>
  );
}
