"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import type { CampaignDto, PostDto } from "@/lib/design/campaigns";
import { PLATFORMS } from "@/lib/design/platforms";
import { deleteCampaignAction, deletePostAction, saveCampaignAction, savePostAction } from "@/lib/design/actions/campaigns";
import { addDays, daysBetween } from "@/lib/design/rules";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { FileDrop } from "../file-drop";
import { fileHref } from "../upload";
import { Badge, Card, Empty, formatDay } from "../ui";
import { PlatformIcon } from "./platform-icon";

/**
 * Campaigns on a timeline (each a bar across its dates, its posts as dots below), then the posts as a list. Leads add and change
 * campaigns; anyone adds posts and changes their own (leads any).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const nextMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

type CampaignDraft = { id: string | null; name: string; description: string; color: string; startDate: string; endDate: string };
type PostDraft = { id: string | null; campaignId: string; platform: (typeof PLATFORMS)[number]; title: string; postUrl: string; postDate: string; status: "planned" | "posted"; notes: string; hasImage: boolean; removeImage: boolean };

function Timeline({ campaigns, posts, today }: { campaigns: CampaignDto[]; posts: PostDto[]; today: string }) {
  const dates = [today, ...campaigns.flatMap((c) => [c.startDate, c.endDate]), ...posts.map((p) => p.postDate)].sort();
  const start = monthStart(dates[0]);
  let end = nextMonth(dates[dates.length - 1]);
  if (daysBetween(start, end) < 90) end = nextMonth(nextMonth(nextMonth(start)));
  const total = daysBetween(start, end);
  const months: string[] = [];
  for (let m = start; m < end; m = nextMonth(m)) months.push(m);
  const pct = (d: string) => `${(Math.max(0, Math.min(total, daysBetween(start, d))) / total) * 100}%`;
  const width = (a: string, b: string) => `${(Math.max(1, daysBetween(a, addDays(b, 1))) / total) * 100}%`;
  const loose = posts.filter((p) => !p.campaignId);
  const rows = [
    ...campaigns.map((c) => ({ key: c.id, label: c.name, color: c.color, bar: { start: c.startDate, end: c.endDate }, dots: posts.filter((p) => p.campaignId === c.id) })),
    ...(loose.length ? [{ key: "loose", label: "Not in a campaign", color: "#64748b", bar: null, dots: loose }] : []),
  ];
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(640, months.length * 110) }}>
        <div className="relative ml-40 flex h-7 border-b border-[var(--ds-line)] text-xs ds-muted">
          {months.map((m) => (
            <span key={m} className="absolute top-1 border-l border-[var(--ds-line)] pl-1.5" style={{ left: pct(m) }}>
              {MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center border-b border-[var(--ds-line)] py-2.5 last:border-0">
            <span className="w-40 shrink-0 truncate pr-3 text-sm font-semibold text-ink" title={r.label}>
              {r.label}
            </span>
            <div className="relative h-9 flex-1">
              <span className="absolute inset-y-0 w-px bg-[var(--ds-red)] opacity-50" style={{ left: pct(today) }} title="Today" aria-hidden />
              {r.bar && (
                <span
                  className="absolute top-0.5 h-3.5 rounded-full opacity-90"
                  style={{ left: pct(r.bar.start), width: width(r.bar.start, r.bar.end), background: r.color }}
                  title={`${formatDay(r.bar.start)} – ${formatDay(r.bar.end)}`}
                />
              )}
              {r.dots.map((p) => (
                <span
                  key={p.id}
                  className="absolute bottom-0.5 h-3 w-3 -translate-x-1/2 rounded-full border-2"
                  style={{ left: pct(p.postDate), borderColor: r.color, background: p.status === "posted" ? r.color : "#fff" }}
                  title={`${p.platform}: ${p.title} (${formatDay(p.postDate)}, ${p.status === "posted" ? "posted" : "planned"})`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs ds-muted">Filled dots are posted, hollow dots planned. The red line is today.</p>
    </div>
  );
}

export function CampaignsView({ campaigns, posts, lead, userId, today }: { campaigns: CampaignDto[]; posts: PostDto[]; lead: boolean; userId: string; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [cDraft, setCDraft] = useState<CampaignDraft | null>(null);
  const [pDraft, setPDraft] = useState<PostDraft | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [platform, setPlatform] = useState("");

  const names = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const shown = posts.filter((p) => (!filter || (p.campaignId ?? "none") === filter) && (!platform || p.platform === platform)).slice().reverse();

  const openCampaign = (c?: CampaignDto) => {
    setError(null);
    setCDraft(c ? { id: c.id, name: c.name, description: c.description ?? "", color: c.color, startDate: c.startDate, endDate: c.endDate } : { id: null, name: "", description: "", color: "#003F8A", startDate: today, endDate: addDays(today, 30) });
  };
  const openPost = (p?: PostDto, campaignId = "") => {
    setError(null);
    setImageId(null);
    setPDraft(
      p
        ? { id: p.id, campaignId: p.campaignId ?? "", platform: p.platform as PostDraft["platform"], title: p.title, postUrl: p.postUrl ?? "", postDate: p.postDate, status: p.status, notes: p.notes ?? "", hasImage: !!p.image, removeImage: false }
        : { id: null, campaignId, platform: "Instagram", title: "", postUrl: "", postDate: today, status: "posted", notes: "", hasImage: false, removeImage: false },
    );
  };

  const saveCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cDraft) return;
    start(async () => {
      const { id, ...input } = cDraft;
      const res = await saveCampaignAction(id, input);
      if (!res.ok) return setError(res.error);
      toast.success(res.message ?? "Saved");
      setCDraft(null);
      router.refresh();
    });
  };
  const savePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pDraft) return;
    start(async () => {
      const { id, campaignId, platform, title, postUrl, postDate, status, notes, removeImage } = pDraft;
      const res = await savePostAction(id, { campaignId: campaignId || null, platform, title, postUrl, postDate, status, notes, removeImage, imageFileId: imageId });
      if (!res.ok) return setError(res.error);
      toast.success(res.message ?? "Saved");
      setPDraft(null);
      router.refresh();
    });
  };
  const removeCampaign = async (c: CampaignDto) => {
    if (!(await confirm({ title: `Delete ${c.name}?`, message: "Its posts stay, no longer in a campaign.", confirmLabel: "Delete", danger: true }))) return;
    start(async () => {
      const res = await deleteCampaignAction(c.id);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  };
  const removePost = async (p: PostDto) => {
    if (!(await confirm({ title: "Delete this post?", message: `"${p.title}" and its image will be removed.`, confirmLabel: "Delete", danger: true }))) return;
    start(async () => {
      const res = await deletePostAction(p.id);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {lead && (
          <button type="button" className="btn btn-sm ds-btn-navy" onClick={() => openCampaign()}>
            <Plus size={14} aria-hidden /> Add campaign
          </button>
        )}
        <button type="button" className={`btn btn-sm ${lead ? "btn-ghost" : "ds-btn-navy"}`} onClick={() => openPost()}>
          <Plus size={14} aria-hidden /> Add post
        </button>
      </div>

      <Card title="Timeline">
        {campaigns.length || posts.length ? <Timeline campaigns={campaigns} posts={posts} today={today} /> : <Empty title="No campaigns or posts yet">{lead ? "Add a campaign, then its posts." : "Add a post to start."}</Empty>}
      </Card>

      {campaigns.length > 0 && (
        <Card title="Campaigns" pad={false}>
          <ul className="divide-y divide-[var(--ds-line)]">
            {campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{c.name}</span>
                  <span className="block text-xs ds-muted">
                    {formatDay(c.startDate)} – {formatDay(c.endDate)} · {posts.filter((p) => p.campaignId === c.id).length} posts
                    {c.description ? ` · ${c.description}` : ""}
                  </span>
                </span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => openPost(undefined, c.id)}>
                  <Plus size={13} aria-hidden /> Post
                </button>
                {lead && (
                  <>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={`Edit ${c.name}`} onClick={() => openCampaign(c)}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={`Delete ${c.name}`} disabled={pending} onClick={() => removeCampaign(c)}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Posts"
        pad={false}
        actions={
          <div className="flex flex-wrap gap-2">
            <select className="input py-1.5 text-sm" aria-label="Campaign" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">Not in a campaign</option>
            </select>
            <select className="input py-1.5 text-sm" aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">All platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        }
      >
        {shown.length === 0 ? (
          <Empty title="No posts">Posts you add appear here.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--ds-line)]">
            {shown.map((p) => {
              const c = p.campaignId ? names.get(p.campaignId) : null;
              const mine = p.createdById === userId || lead;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileHref(p.image.fileId, true)} alt="" className="h-12 w-12 rounded-lg border border-[var(--ds-line)] object-cover" />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-lg bg-[var(--ds-navy-tint)]">
                      <PlatformIcon platform={p.platform} size={20} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <PlatformIcon platform={p.platform} size={14} />
                      <span className="font-semibold text-ink">{p.title}</span>
                      <Badge tone={p.status === "posted" ? "green" : "amber"}>{p.status === "posted" ? "Posted" : "Planned"}</Badge>
                    </span>
                    <span className="block text-xs ds-muted">
                      {p.platform} · {formatDay(p.postDate)}
                      {c ? ` · ${c.name}` : ""}
                      {p.createdBy ? ` · added by ${p.createdBy}` : ""}
                    </span>
                    {p.notes && <span className="block text-xs text-ink">{p.notes}</span>}
                  </span>
                  {p.postUrl && (
                    <a href={p.postUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" aria-label={`Open ${p.title}`}>
                      <ExternalLink size={13} />
                    </a>
                  )}
                  {mine && (
                    <>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label={`Edit ${p.title}`} onClick={() => openPost(p)}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label={`Delete ${p.title}`} disabled={pending} onClick={() => removePost(p)}>
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {cDraft && (
        <Modal title={cDraft.id ? "Edit campaign" : "Add campaign"} onClose={() => setCDraft(null)}>
          <form onSubmit={saveCampaign} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Name</span>
              <input className="input" required maxLength={120} value={cDraft.name} onChange={(e) => setCDraft({ ...cDraft, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Description</span>
              <textarea className="input" maxLength={1000} value={cDraft.description} onChange={(e) => setCDraft({ ...cDraft, description: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Starts</span>
                <input type="date" className="input" required value={cDraft.startDate} onChange={(e) => setCDraft({ ...cDraft, startDate: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Ends</span>
                <input type="date" className="input" required min={cDraft.startDate} value={cDraft.endDate} onChange={(e) => setCDraft({ ...cDraft, endDate: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Colour</span>
                <input type="color" className="input h-[42px] p-1" value={cDraft.color} onChange={(e) => setCDraft({ ...cDraft, color: e.target.value })} />
              </label>
            </div>
            {error && <p role="alert" className="text-sm text-[var(--ds-red)]">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm ds-btn-navy" disabled={pending}>
                Save campaign
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pDraft && (
        <Modal title={pDraft.id ? "Edit post" : "Add post"} onClose={() => setPDraft(null)}>
          <form onSubmit={savePost} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Title</span>
              <input className="input" required maxLength={200} value={pDraft.title} onChange={(e) => setPDraft({ ...pDraft, title: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Platform</span>
                <select className="input" value={pDraft.platform} onChange={(e) => setPDraft({ ...pDraft, platform: e.target.value as PostDraft["platform"] })}>
                  {PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Campaign</span>
                <select className="input" value={pDraft.campaignId} onChange={(e) => setPDraft({ ...pDraft, campaignId: e.target.value })}>
                  <option value="">Not in a campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Date</span>
                <input type="date" className="input" required value={pDraft.postDate} onChange={(e) => setPDraft({ ...pDraft, postDate: e.target.value })} />
              </label>
              <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="mb-1 font-medium">Status</legend>
                <div className="flex gap-4 pt-2">
                  {(["posted", "planned"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input type="radio" name="post-status" className="accent-[#003F8A]" checked={pDraft.status === s} onChange={() => setPDraft({ ...pDraft, status: s })} />
                      {s === "posted" ? "Posted" : "Planned"}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Link to the post</span>
              <input className="input" type="url" placeholder="https://" maxLength={500} value={pDraft.postUrl} onChange={(e) => setPDraft({ ...pDraft, postUrl: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Notes</span>
              <textarea className="input" maxLength={1000} value={pDraft.notes} onChange={(e) => setPDraft({ ...pDraft, notes: e.target.value })} />
            </label>
            <div className="text-sm">
              <p className="mb-1 font-medium">Image</p>
              {pDraft.hasImage && !pDraft.removeImage && !imageId && (
                <p className="mb-2 flex items-center gap-2 text-xs ds-muted">
                  This post has an image.
                  <button type="button" className="font-semibold text-[var(--ds-red)] hover:underline" onClick={() => setPDraft({ ...pDraft, removeImage: true })}>
                    Remove it
                  </button>
                </p>
              )}
              <FileDrop purpose="post_image" maxFiles={1} maxMb={10} multiple={false} label={pDraft.hasImage ? "Drop a new image to replace it" : "Drop an image here or click to browse"} onChange={(ids) => setImageId(ids[0] ?? null)} onBusy={setUploading} />
            </div>
            {error && <p role="alert" className="text-sm text-[var(--ds-red)]">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm ds-btn-navy" disabled={pending || uploading}>
                Save post
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
