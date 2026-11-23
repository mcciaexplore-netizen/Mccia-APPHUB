"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import type { HalfDay } from "@/db/attendance-schema";
import { applyLeaveAction, beginUploadAction, previewLeaveAction, searchPeopleAction } from "@/lib/attendance/actions/staff";
import { ALLOWED_DOC_TYPES, MAX_FILE_MB, leaveColor } from "@/lib/attendance/att.manifest";
import { useToast } from "@/components/Toast";
import { Card, Field } from "../ui";
import { useAct } from "../use-act";

export type ApplyType = {
  id: string;
  name: string;
  color: string;
  balance: number;
  allowHalfDay: boolean;
  halfDayFirst: boolean;
  halfDaySecond: boolean;
  requiresReason: boolean;
  requiresDocumentAfterDays: number | null;
  noticePeriodDays: number;
  maxConsecutiveDays: number | null;
  isCompoff: boolean;
};

/** Apply for leave: type, dates, half day, reason, a document when needed, colleagues to CC, and who will approve it. */
export function ApplyLeaveForm({ types, today, approver }: { types: ApplyType[]; today: string; approver: string }) {
  const router = useRouter();
  const toast = useToast();
  const { act, pending } = useAct();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [half, setHalf] = useState<HalfDay>("none");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<{ key: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cc, setCc] = useState<{ id: string; name: string }[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const type = types.find((t) => t.id === typeId);
  const fileInput = useRef<HTMLInputElement>(null);

  const effectiveEnd = half !== "none" ? start : end;
  useEffect(() => {
    let live = true;
    if (!typeId || !start || !effectiveEnd || effectiveEnd < start) {
      queueMicrotask(() => live && setDays(null));
      return () => {
        live = false;
      };
    }
    previewLeaveAction(typeId, start, effectiveEnd, half).then((r) => live && setDays(r.ok ? r.data : null));
    return () => {
      live = false;
    };
  }, [typeId, start, effectiveEnd, half]);

  const needsDoc = type?.requiresDocumentAfterDays != null && days != null && days > type.requiresDocumentAfterDays;

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const r = await beginUploadAction(f.name, f.size, f.type);
      if (!r.ok) return toast.error(r.error);
      const put = await fetch(r.data.uploadUrl, { method: "PUT", headers: { "content-type": f.type }, body: f });
      if (!put.ok) return toast.error("The document could not be uploaded. Please try again.");
      setFile({ key: r.data.key, name: f.name });
    } catch {
      toast.error("The document could not be uploaded. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const r = await act(() => applyLeaveAction({ leaveTypeId: typeId, startDate: start, endDate: effectiveEnd, halfDay: half, reason, attachmentKey: file?.key ?? null, attachmentName: file?.name ?? null, ccUserIds: cc.map((c) => c.id) }), { noRefresh: true });
    if (r.ok) router.push("/attendance/leave");
  };

  if (!types.length) return <Card>No leave types are available to you yet. Ask HR.</Card>;
  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset>
          <legend className="mb-2 text-xs font-semibold att-muted">Leave type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTypeId(t.id);
                  if (!t.allowHalfDay) setHalf("none");
                }}
                aria-pressed={t.id === typeId}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${t.id === typeId ? "border-[var(--att-primary)] bg-[var(--att-primary-tint)]" : "border-[var(--att-line)]"}`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: leaveColor(t.color) }} aria-hidden />
                  {t.name}
                </span>
                <span className="tabular-nums att-muted">{t.balance} left</span>
              </button>
            ))}
          </div>
          {type && (
            <p className="mt-2 text-xs att-muted">
              {[
                type.noticePeriodDays > 0 ? `${type.noticePeriodDays} day${type.noticePeriodDays === 1 ? "" : "s"}' notice` : "No notice needed (can be applied for recent past days)",
                type.maxConsecutiveDays ? `at most ${type.maxConsecutiveDays} days at a time` : null,
                type.requiresDocumentAfterDays != null ? `document needed for more than ${type.requiresDocumentAfterDays} days` : null,
                type.isCompoff ? "uses your earned comp-offs, oldest first" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="att-leave-dates">
          <Field label="From">
            <input
              type="date"
              className="input att-date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
              required
            />
          </Field>
          <Field label="To">
            <input type="date" className="input att-date" value={effectiveEnd} min={start} disabled={half !== "none"} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
          <Field label="Half day" className="col-span-2 md:col-span-1">
            <select className="input att-date" value={half} onChange={(e) => setHalf(e.target.value as HalfDay)} disabled={!type?.allowHalfDay}>
              <option value="none">Full day(s)</option>
              {type?.halfDayFirst && <option value="first">First half</option>}
              {type?.halfDaySecond && <option value="second">Second half</option>}
            </select>
          </Field>
        </div>
        <p className="text-sm font-semibold text-ink">{days == null ? "—" : `${days} day${days === 1 ? "" : "s"} of leave`} <span className="font-normal att-muted">(weekly offs and holidays are not counted)</span></p>

        <Field label={`Reason${type?.requiresReason ? " (required)" : " (optional)"}`}>
          <textarea className="input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required={type?.requiresReason} />
        </Field>

        <div>
          <p className="mb-1 text-xs font-semibold att-muted">Supporting document {needsDoc ? "(required)" : "(optional)"}</p>
          {file ? (
            <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--att-line)] px-3 py-1.5 text-sm">
              <Paperclip size={14} aria-hidden /> {file.name}
              <button type="button" onClick={() => setFile(null)} aria-label="Remove document">
                <X size={14} />
              </button>
            </span>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                <Paperclip size={14} aria-hidden /> {uploading ? "Uploading…" : "Attach a PDF or photo"}
              </button>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept={ALLOWED_DOC_TYPES.join(",")}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <span className="ml-2 text-xs att-muted">Up to {MAX_FILE_MB} MB</span>
            </>
          )}
        </div>

        <CcPicker cc={cc} setCc={setCc} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--att-line)] pt-4">
          <p className="text-sm att-muted">
            Goes to <span className="font-semibold text-ink">{approver}</span> for approval.
          </p>
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending || uploading || !days || (needsDoc && !file)}>
            {pending ? "Sending…" : "Apply for leave"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function CcPicker({ cc, setCc }: { cc: { id: string; name: string }[]; setCc: (v: { id: string; name: string }[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; email: string }[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) return live && setHits([]);
      const r = await searchPeopleAction(q);
      if (live) setHits(r.ok ? r.data : []);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold att-muted">CC colleagues (optional): they are told about the leave</p>
      <div className="flex flex-wrap gap-1.5">
        {cc.map((c) => (
          <span key={c.id} className="att-badge att-tone-primary">
            {c.name}
            <button type="button" onClick={() => setCc(cc.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {cc.length < 10 && (
        <div className="relative mt-1.5 max-w-sm">
          <input className="input" placeholder="Type a name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a colleague to CC" />
          {hits.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--att-line)] bg-(--att-card) shadow-lg">
              {hits
                .filter((h) => !cc.some((c) => c.id === h.id))
                .map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--att-primary-tint)]"
                      onClick={() => {
                        setCc([...cc, { id: h.id, name: h.name }]);
                        setQ("");
                        setHits([]);
                      }}
                    >
                      {h.name} <span className="text-xs att-muted">{h.email}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
