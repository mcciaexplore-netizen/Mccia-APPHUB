"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Bookmark, Search, Trash2, X } from "lucide-react";
import type { Priority, TicketStatus } from "@/db/design-schema";
import type { TicketCard } from "@/lib/design/tickets";
import type { ViewDto } from "@/lib/design/detail";
import { BOARD_STATUSES, DEFAULT_WIP_LIMITS, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, dueHealth, EXTRA_REVISION_TAG, LAST_MINUTE_TAG } from "@/lib/design/rules";
import { bulkAction, deleteViewAction, saveViewAction, updateTicketAction } from "@/lib/design/actions/tickets";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Avatar, Badge, PriorityBadge, formatDateTime } from "../ui";

/**
 * The kanban board, for both sections: /design/board (scope "mine": the designer's own tickets, the server sends nothing else) and
 * /design/admin/board (scope "all"). Columns are the seven stages, or one per person. Cards drag between columns (a native drag, no
 * library): moving a stage changes the status, moving between people re-assigns (leads only). The move shows at once and is undone with a
 * message if the server refuses it (for example In review without a review link out). Search, filters and saved views narrow the cards;
 * ticking cards opens a bar to move (and, for leads, assign or reprioritise) them together.
 */

type Props = { tickets: TicketCard[]; scope: "mine" | "all"; lead: boolean; people: { id: string; name: string }[]; views: ViewDto[]; types: { key: string; name: string }[] };
type Group = "status" | "assignee";
type Filters = { search: string; assignee: string; type: string; priority: string; overdue: string };

const EMPTY: Filters = { search: "", assignee: "", type: "", priority: "", overdue: "" };
const GROUP_KEY = "design-board-group";
const UNASSIGNED = "unassigned";

/** The board column a status sits in: "closed without approval" shares the Closed column. */
const columnOf = (s: TicketStatus): TicketStatus => (s === "closed_without_approval" ? "closed" : s);

/** The group-by choice kept in this browser (stages when storage is unavailable, and on the server). */
const storedGroup = (): Group => {
  try {
    return localStorage.getItem(GROUP_KEY) === "assignee" ? "assignee" : "status";
  } catch {
    return "status";
  }
};
const onStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export function Board({ tickets, scope, lead, people, views, types }: Props) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [cards, setCards] = useState(tickets);
  const [serverTickets, setServerTickets] = useState(tickets);
  const saved = useSyncExternalStore(onStorage, storedGroup, () => "status" as Group);
  const [chosen, setChosen] = useState<Group | null>(null);
  const group = chosen ?? saved;
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [viewId, setViewId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewShared, setViewShared] = useState(false);
  const [bulk, setBulk] = useState({ status: "", assignee: "", priority: "" });

  // The server's list wins whenever it changes (after a refresh), replacing any optimistic moves.
  if (tickets !== serverTickets) {
    setServerTickets(tickets);
    setCards(tickets);
  }
  const chooseGroup = (g: Group) => {
    setChosen(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      // ignored
    }
  };

  const typeName = useMemo(() => new Map(types.map((t) => [t.key, t.name])), [types]);
  const allScope = scope === "all";

  const shown = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const tName = filters.type ? typeName.get(filters.type) : null;
    return cards.filter(
      (t) =>
        (!q || t.number.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || (t.requesterName ?? "").toLowerCase().includes(q) || (t.department ?? "").toLowerCase().includes(q)) &&
        (!filters.assignee || (filters.assignee === UNASSIGNED ? !t.assigneeId : t.assigneeId === filters.assignee)) &&
        (!tName || t.designs.includes(tName)) &&
        (!filters.priority || t.priority === filters.priority) &&
        (!filters.overdue || dueHealth(t.dueAt, t.status) === "overdue"),
    );
  }, [cards, filters, typeName]);

  const columns = useMemo(() => {
    if (group === "status") return BOARD_STATUSES.map((s) => ({ key: s as string, label: STATUS_LABEL[s], limit: DEFAULT_WIP_LIMITS[s] }));
    const cols = [{ key: UNASSIGNED, label: "Unassigned", limit: undefined as number | undefined }, ...people.map((p) => ({ key: p.id, label: p.name, limit: undefined as number | undefined }))];
    for (const t of cards) if (t.assigneeId && !cols.some((c) => c.key === t.assigneeId)) cols.push({ key: t.assigneeId, label: t.assigneeName ?? "Former team member", limit: undefined });
    return cols;
  }, [group, people, cards]);

  const keyOf = (t: TicketCard) => (group === "status" ? columnOf(t.status) : (t.assigneeId ?? UNASSIGNED));
  const canDrag = group === "status" || lead;

  const setFilter = (k: keyof Filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setViewId("");
  };

  const applyView = (id: string) => {
    setViewId(id);
    const v = views.find((x) => x.id === id);
    if (!v) return setFilters(EMPTY);
    setFilters({ ...EMPTY, ...Object.fromEntries(Object.entries(v.filters).filter(([k]) => k in EMPTY)) });
    if (v.filters.group === "assignee" || v.filters.group === "status") chooseGroup(v.filters.group);
  };

  const drop = async (col: string) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const t = cards.find((c) => c.id === id);
    if (!t || keyOf(t) === col) return;
    const before = cards;
    const patch = group === "status" ? { status: col as TicketStatus } : { assigneeId: col === UNASSIGNED ? null : col };
    const person = group === "assignee" && col !== UNASSIGNED ? people.find((p) => p.id === col)?.name ?? null : null;
    setCards((cur) => cur.map((c) => (c.id === id ? { ...c, ...(group === "status" ? { status: col as TicketStatus } : { assigneeId: col === UNASSIGNED ? null : col, assigneeName: person }) } : c)));
    const r = await updateTicketAction(id, patch);
    if (!r.ok) {
      setCards(before);
      toast.error(`${t.number}: ${r.error}`);
      return;
    }
    toast.success(group === "status" ? `${t.number} moved to ${STATUS_LABEL[col as TicketStatus]}` : `${t.number} ${col === UNASSIGNED ? "unassigned" : `assigned to ${person}`}`);
    startTransition(() => router.refresh());
  };

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async () => {
    const patch: { status?: TicketStatus; assigneeId?: string | null; priority?: Priority } = {};
    if (bulk.status) patch.status = bulk.status as TicketStatus;
    if (lead && bulk.assignee) patch.assigneeId = bulk.assignee === UNASSIGNED ? null : bulk.assignee;
    if (lead && bulk.priority) patch.priority = bulk.priority as Priority;
    if (!Object.keys(patch).length) return toast.error("Choose what to change first.");
    const r = await bulkAction([...selected], patch);
    if (!r.ok) return toast.error(r.error);
    const { updated, skipped } = r.data;
    if (updated) toast.success(`${updated} ticket${updated === 1 ? "" : "s"} updated`);
    if (skipped) toast.error(`${skipped} ticket${skipped === 1 ? " was" : "s were"} skipped (closed, or the change isn't allowed there)`);
    setSelected(new Set());
    setBulk({ status: "", assignee: "", priority: "" });
    startTransition(() => router.refresh());
  };

  const saveView = async () => {
    const r = await saveViewAction(viewName, { ...filters, group }, viewShared);
    if (!r.ok) return toast.error(r.error);
    toast.success("View saved");
    setSaving(false);
    setViewName("");
    setViewShared(false);
    startTransition(() => router.refresh());
  };

  const removeView = async () => {
    const v = views.find((x) => x.id === viewId);
    if (!v || !(await confirm({ title: "Delete this view?", message: `"${v.name}" will be removed${v.isShared ? " for everyone it is shared with" : ""}.`, confirmLabel: "Delete", danger: true }))) return;
    const r = await deleteViewAction(v.id);
    if (!r.ok) return toast.error(r.error);
    applyView("");
    startTransition(() => router.refresh());
  };

  const mineViews = views.filter((v) => v.mine);
  const sharedViews = views.filter((v) => !v.mine && v.isShared);
  const current = views.find((v) => v.id === viewId);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="ds-card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search tickets</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <input className="input !pl-9" placeholder="Search number, title, requester, department" value={filters.search} onChange={(e) => setFilter("search", e.target.value)} />
          </label>
          {allScope && (
            <label className="flex flex-col gap-1">
              <span className="ds-label">Assignee</span>
              <select className="input !py-2" value={filters.assignee} onChange={(e) => setFilter("assignee", e.target.value)}>
                <option value="">Everyone</option>
                <option value={UNASSIGNED}>Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="ds-label">Design</span>
            <select className="input !py-2" value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
              <option value="">All designs</option>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ds-label">Priority</span>
            <select className="input !py-2" value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)}>
              <option value="">Any</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={!!filters.overdue} onChange={(e) => setFilter("overdue", e.target.checked ? "1" : "")} />
            Overdue only
          </label>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyView("")}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <Bookmark size={14} className="text-[var(--ds-navy)]" aria-hidden />
            <span className="sr-only">Saved view</span>
            <select className="input !py-1.5 text-sm" value={viewId} onChange={(e) => applyView(e.target.value)}>
              <option value="">Saved views…</option>
              {mineViews.length > 0 && (
                <optgroup label="My views">
                  {mineViews.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.isShared ? " (shared)" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {sharedViews.length > 0 && (
                <optgroup label="Shared by the team">
                  {sharedViews.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.owner ?? "team"})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {current && (current.mine || lead) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeView} aria-label={`Delete view ${current.name}`}>
              <Trash2 size={14} />
            </button>
          )}
          {!saving ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving(true)}>
              Save current view
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <label>
                <span className="sr-only">View name</span>
                <input className="input !py-1.5 text-sm" placeholder="Name this view" value={viewName} maxLength={60} onChange={(e) => setViewName(e.target.value)} autoFocus />
              </label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <input type="checkbox" checked={viewShared} onChange={(e) => setViewShared(e.target.checked)} /> Share with the team
              </label>
              <button type="button" className="btn btn-sm ds-btn-navy" onClick={saveView}>
                Save
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving(false)}>
                Cancel
              </button>
            </span>
          )}
          <div className="ml-auto ds-tabs" role="tablist" aria-label="Group the board">
            {(["status", "assignee"] as Group[]).map((g) => (
              <button key={g} type="button" role="tab" aria-selected={group === g} className="ds-tab" onClick={() => chooseGroup(g)}>
                {g === "status" ? "By stage" : "By person"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="ds-card sticky top-20 z-10 flex flex-wrap items-center gap-3 border-[var(--ds-navy-line)] bg-[#f8fbff] p-3" role="region" aria-label="Change selected tickets">
          <span className="text-sm font-bold text-[var(--ds-navy)]">{selected.size} selected</span>
          <label>
            <span className="sr-only">Move to</span>
            <select className="input !py-1.5 text-sm" value={bulk.status} onChange={(e) => setBulk((b) => ({ ...b, status: e.target.value }))}>
              <option value="">Move to…</option>
              {BOARD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {lead && (
            <>
              <label>
                <span className="sr-only">Assign to</span>
                <select className="input !py-1.5 text-sm" value={bulk.assignee} onChange={(e) => setBulk((b) => ({ ...b, assignee: e.target.value }))}>
                  <option value="">Assign to…</option>
                  <option value={UNASSIGNED}>Nobody (unassign)</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Priority</span>
                <select className="input !py-1.5 text-sm" value={bulk.priority} onChange={(e) => setBulk((b) => ({ ...b, priority: e.target.value }))}>
                  <option value="">Priority…</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button type="button" className="btn btn-sm ds-btn-navy" onClick={runBulk}>
            Apply
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <p className="text-xs ds-muted">
        {shown.length} of {cards.length} ticket{cards.length === 1 ? "" : "s"}
        {canDrag ? " · drag a card to another column to " + (group === "status" ? "move it" : "re-assign it") : " · only a design lead can re-assign"}
      </p>

      <div className="ds-board">
        {columns.map((col) => {
          const inCol = shown.filter((t) => keyOf(t) === col.key);
          const total = cards.filter((t) => keyOf(t) === col.key).length;
          const over = col.limit !== undefined && total > col.limit;
          return (
            <section
              key={col.key}
              className="ds-col"
              data-over={overCol === col.key}
              aria-label={`${col.label}: ${inCol.length} ticket${inCol.length === 1 ? "" : "s"}`}
              onDragOver={(e) => {
                if (!dragId || !canDrag) return;
                e.preventDefault();
                setOverCol(col.key);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                void drop(col.key);
              }}
            >
              <div className="ds-col-head">
                <h3 className="truncate text-[0.82rem] font-bold text-ink">{col.label}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${over ? "bg-[var(--ds-red)] text-white" : "bg-white text-subtle"}`} title={col.limit ? `Work-in-progress limit ${col.limit}` : undefined}>
                  {col.limit !== undefined ? `${total}/${col.limit}` : inCol.length}
                </span>
              </div>
              {inCol.map((t) => (
                <TicketCardView
                  key={t.id}
                  t={t}
                  draggable={canDrag && !t.isLocked}
                  dragging={dragId === t.id}
                  selected={selected.has(t.id)}
                  onToggle={() => toggle(t.id)}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  onOpen={() => router.push(`/design/tickets/${t.id}`)}
                  showAssignee={group === "status"}
                />
              ))}
              {inCol.length === 0 && <p className="px-2 py-4 text-center text-xs ds-muted">No tickets</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TicketCardView({
  t,
  draggable,
  dragging,
  selected,
  onToggle,
  onDragStart,
  onDragEnd,
  onOpen,
  showAssignee,
}: {
  t: TicketCard;
  draggable: boolean;
  dragging: boolean;
  selected: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  showAssignee: boolean;
}) {
  const health = dueHealth(t.dueAt, t.status);
  const dueColor = health === "overdue" ? "text-[var(--ds-red)] font-semibold" : health === "soon" ? "text-[#b45309] font-semibold" : "ds-muted";
  const flags = t.tags.filter((x) => x === EXTRA_REVISION_TAG || x === LAST_MINUTE_TAG);
  return (
    <article
      className="ds-tcard"
      data-selected={selected}
      data-dragging={dragging}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      style={{ cursor: draggable ? "grab" : "pointer" }}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={selected}
          aria-label={`Select ${t.number}`}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <Link href={`/design/tickets/${t.id}`} draggable={false} onClick={(e) => e.stopPropagation()} className="text-xs font-bold text-[var(--ds-navy)] hover:underline">
            {t.number}
          </Link>
          <p className="mt-0.5 line-clamp-2 text-[0.85rem] font-semibold leading-snug text-ink">{t.title}</p>
        </div>
        {showAssignee && <Avatar name={t.assigneeName} size={24} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={t.priority} />
        {t.status === "closed_without_approval" && <Badge tone="neutral">No approval</Badge>}
        {flags.map((f) => (
          <Badge key={f} tone={f === LAST_MINUTE_TAG ? "red" : "amber"}>
            {f}
          </Badge>
        ))}
      </div>
      {t.designs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {t.designs.slice(0, 3).map((d) => (
            <span key={d} className="rounded bg-[var(--ds-grey-tint)] px-1.5 py-0.5 text-[0.68rem] font-medium text-[#475569]">
              {d}
            </span>
          ))}
          {t.designs.length > 3 && <span className="text-[0.68rem] ds-muted">+{t.designs.length - 3}</span>}
        </div>
      )}
      <p className={`mt-2 text-[0.72rem] ${dueColor}`} suppressHydrationWarning>
        {t.dueAt ? `Due ${formatDateTime(t.dueAt)}` : "No deadline"}
        {health === "overdue" && " · overdue"}
      </p>
    </article>
  );
}
