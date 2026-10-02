import { roleLabel } from "@/lib/format";

/** Who the hub is acting as. There is no sign-in, so this is a label, not a menu. */
export function UserMenu({ name, role }: { name: string; role: keyof typeof roleLabel }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-muted">
      <span className="max-w-40 truncate">{name}</span>
      <span className="badge">{roleLabel[role]}</span>
    </div>
  );
}
