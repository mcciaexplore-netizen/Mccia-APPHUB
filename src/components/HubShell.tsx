import { HubFrame, type ShellUser } from "@/components/HubFrame";
import { UserMenu } from "@/components/UserMenu";
import { getCurrentUser } from "@/lib/permissions";

export type { ShellUser };

/**
 * The frame of every page (see HubFrame). Pages give the name and role they already have; the person's email and profile photo, which the
 * menu shows, are read here from the signed-in person's record. That read is the one every page already makes to know who is asking (it is
 * cached for the request), so it costs no extra query, and no page has to carry the photo.
 */
export async function HubShell({ user, unread, bleed = false, children }: {
  user: ShellUser | null; /** Unread notifications; the bell is shown when this is given. */ unread?: number;
  /** The page fills the space under the top bar edge to edge, without the usual margins (Payment Desk's frame). */ bleed?: boolean;
  children: React.ReactNode;
}) {
  const me = user ? await getCurrentUser() : null;
  const menu = user ? <UserMenu name={user.name} email={me?.email ?? ""} role={user.role} avatarUrl={me?.avatarUrl ?? null} /> : null;
  return <HubFrame user={user} unread={unread} bleed={bleed} menu={menu}>{children}</HubFrame>;
}
