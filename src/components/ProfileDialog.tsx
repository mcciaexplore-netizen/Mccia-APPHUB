"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { removeAvatar, uploadAvatar } from "@/actions/profile";
import { Avatar } from "@/components/Avatar";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { AVATAR_ACCEPT, AVATAR_TYPE_MESSAGE, MAX_AVATAR_MB, avatarSizeProblem } from "@/lib/avatar-rules";

const TYPES = AVATAR_ACCEPT.split(",");
const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * "Edit Profile": the person's photo. Choose a JPG, PNG or WebP (up to 2 MB), see it here before anything is saved, then Save (or Cancel).
 * The name and email are shown but set by the administrator. `onChanged` tells the menu the new address at once, so the header shows the
 * photo without waiting for the page to reload.
 */
export function ProfileDialog({ name, email, avatarUrl, onClose, onChanged }: { name: string; email: string; avatarUrl: string | null; onClose: () => void; onChanged: (url: string | null) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The preview's temporary address is given back when it is replaced or the dialog closes.
  const live = useRef<string | null>(null);
  useEffect(() => () => { if (live.current) URL.revokeObjectURL(live.current); }, []);

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again still counts as a choice
    if (!file) return;
    const bad = !TYPES.includes(file.type) ? AVATAR_TYPE_MESSAGE : avatarSizeProblem(file.size);
    setProblem(bad);
    if (bad) return;
    if (live.current) URL.revokeObjectURL(live.current);
    const url = URL.createObjectURL(file);
    live.current = url;
    setPicked({ file, url });
  };

  const done = (message: string, url: string | null) => {
    toast.success(message);
    onChanged(url);
    router.refresh();
    onClose();
  };
  const save = () => {
    if (!picked) return;
    const fd = new FormData();
    fd.set("file", picked.file);
    start(async () => {
      const r = await uploadAvatar(fd);
      if (r.ok) done("Profile photo updated", r.data.url);
      else setProblem(r.error);
    });
  };
  const remove = () =>
    start(async () => {
      const r = await removeAvatar();
      if (r.ok) done("Profile photo removed", null);
      else setProblem(r.error);
    });

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <Avatar name={name} src={picked?.url ?? avatarUrl} size={96} />
          {picked && <span className="text-xs font-semibold text-primary">Preview</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
          <div>
            <p className="truncate font-bold text-ink">{name}</p>
            {email && <p className="truncate text-sm text-muted">{email}</p>}
            <p className="mt-1 text-xs text-subtle">Your name and email are set by your administrator.</p>
          </div>
          <div>
            <input ref={input} type="file" accept={AVATAR_ACCEPT} className="sr-only" aria-label="Choose a profile photo" onChange={choose} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => input.current?.click()}>
              <Camera size={14} aria-hidden /> {picked || avatarUrl ? "Choose a different photo" : "Choose a photo"}
            </button>
            <p className="mt-1.5 text-xs text-subtle">JPG, PNG or WebP, up to {MAX_AVATAR_MB} MB.</p>
            {picked && <p className="mt-1 break-all text-xs text-muted">{picked.file.name} · {sizeLabel(picked.file.size)}</p>}
          </div>
        </div>
      </div>
      {problem && <p role="alert" className="alert alert-red mt-4">{problem}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          {avatarUrl && !picked && (
            <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={remove}><Trash2 size={14} aria-hidden /> Remove photo</button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!picked || pending} onClick={save}>{pending ? "Saving…" : "Save photo"}</button>
        </div>
      </div>
    </Modal>
  );
}
