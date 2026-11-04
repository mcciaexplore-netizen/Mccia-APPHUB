"use client";

import type { FilePurpose } from "@/db/aistudio-schema";
import { beginUpload } from "@/lib/aistudio/actions/requests";

/**
 * Uploads one file straight to storage: the server hands out a signed link (and checks the size), then the browser PUTs the bytes to it.
 * Resolves with the file's id, which whatever uses it then claims (the request, or a deliverable).
 */
export async function uploadFile(purpose: FilePurpose, file: File, onProgress?: (pct: number) => void): Promise<{ fileId: string; fileName: string; size: number }> {
  const begin = await beginUpload(purpose, file.name, file.size);
  if (!begin.ok) throw new Error(begin.error);
  const { fileId, uploadUrl, mime } = begin.data;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", mime);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`"${file.name}" could not be uploaded (${xhr.status}). Please try again.`)));
    xhr.onerror = () => reject(new Error(`"${file.name}" could not be uploaded. Check your connection and try again.`));
    xhr.send(file);
  });
  return { fileId, fileName: file.name, size: file.size };
}
