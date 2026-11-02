import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { cdrDownloads, cdrRequests, type CdrStatus } from "@/db/design-schema";
import { audit } from "./audit";
import { DesignError, type SessionUser } from "./dal";
import { claimFiles, fileById, fileLink } from "./files";
import { peopleByIds } from "./host-adapter";
import * as notice from "./notify";
import { getTicket, ticketForRequester, ticketForTeam } from "./tickets";
import { FINISHED_STATUSES } from "./rules";

/**
 * Source files (CDR, PSD, AI ...): released only once a design has been signed off. The requester asks, a lead approves (or declines),
 * the designer uploads it (up to 50 MB), and the requester downloads it. Every download is logged.
 */

export type CdrDto = {
  id: string;
  ticketId: string;
  status: CdrStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  createdAt: string;
  file: { id: string; fileName: string; size: number } | null;
  downloads: { by: string | null; at: string }[];
};

export async function cdrFor(ticketIds: string[]): Promise<CdrDto[]> {
  if (!ticketIds.length) return [];
  const rows = await db.select().from(cdrRequests).where(inArray(cdrRequests.ticketId, ticketIds)).orderBy(desc(cdrRequests.createdAt));
  const dl = rows.length ? await db.select().from(cdrDownloads).where(inArray(cdrDownloads.cdrRequestId, rows.map((r) => r.id))).orderBy(desc(cdrDownloads.downloadedAt)) : [];
  const people = await peopleByIds([...rows.flatMap((r) => [r.requesterId, r.approverId]), ...dl.map((d) => d.userId)]);
  const out: CdrDto[] = [];
  for (const r of rows) {
    const f = r.fileId ? await fileById(r.fileId) : null;
    out.push({
      id: r.id,
      ticketId: r.ticketId,
      status: r.status,
      requestedBy: people.get(r.requesterId)?.name ?? null,
      decidedBy: r.approverId ? (people.get(r.approverId)?.name ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      file: f ? { id: f.id, fileName: f.fileName, size: f.size } : null,
      downloads: dl.filter((d) => d.cdrRequestId === r.id).map((d) => ({ by: people.get(d.userId)?.name ?? null, at: d.downloadedAt.toISOString() })),
    });
  }
  return out;
}

const releasable = (s: string) => FINISHED_STATUSES.includes(s as never);

/** The requester (from My Requests) or a team member on the ticket asks for the source file. */
export async function requestCdr(u: SessionUser, ticketId: string, asRequester: boolean): Promise<void> {
  const t = asRequester ? await ticketForRequester(u, ticketId) : await ticketForTeam(u, ticketId);
  if (!releasable(t.status)) throw new DesignError("The source file can be asked for once the design is approved.");
  const [open] = await db
    .select({ id: cdrRequests.id })
    .from(cdrRequests)
    .where(and(eq(cdrRequests.ticketId, t.id), inArray(cdrRequests.status, ["requested", "approved"])))
    .limit(1);
  if (open) throw new DesignError("The source file has already been asked for.");
  await db.insert(cdrRequests).values({ ticketId: t.id, requesterId: u.id });
  await audit(t.id, u.id, "Source file requested", {});
  await notice.cdrRequested(t, u.name);
}

export async function decideCdr(u: SessionUser, requestId: string, approve: boolean): Promise<void> {
  if (!u.lead) throw new DesignError("Only a design lead can approve source-file requests.");
  const [done] = await db
    .update(cdrRequests)
    .set({ status: approve ? "approved" : "declined", approverId: u.id, decidedAt: new Date() })
    .where(and(eq(cdrRequests.id, requestId), eq(cdrRequests.status, "requested")))
    .returning();
  if (!done) throw new DesignError("That request has already been decided.");
  const t = await getTicket(done.ticketId);
  await audit(done.ticketId, u.id, approve ? "Source file approved" : "Source file declined", {});
  if (t) await notice.cdrUpdate(t, approve ? `Your request for the source files of "${t.title}" (${t.number}) was approved. The designer will upload them shortly.` : `Your request for the source files of "${t.title}" (${t.number}) was declined.`, approve ? "approved" : "declined");
}

export async function uploadCdr(u: SessionUser, requestId: string, fileId: string): Promise<void> {
  const [r] = await db.select().from(cdrRequests).where(eq(cdrRequests.id, requestId)).limit(1);
  if (!r) throw new DesignError("That request was not found.");
  const t = await ticketForTeam(u, r.ticketId);
  if (r.status !== "approved") throw new DesignError(r.status === "requested" ? "A design lead must approve the request first." : "That request is closed.");
  const [f] = await claimFiles(u.id, [fileId], "cdr");
  await db.update(cdrRequests).set({ status: "uploaded", fileId: f.id, uploadedBy: u.id }).where(eq(cdrRequests.id, requestId));
  await audit(t.id, u.id, "Source file uploaded", { file_name: f.fileName });
  await notice.cdrUpdate(t, `The source files of "${t.title}" (${t.number}) are ready. Download them from My Requests in the App Hub.`, "uploaded");
}

/** A 60-second download link for the requester or the team; logs the download. */
export async function cdrDownloadLink(u: SessionUser, requestId: string): Promise<string> {
  const [r] = await db.select().from(cdrRequests).where(eq(cdrRequests.id, requestId)).limit(1);
  const t = r ? await getTicket(r.ticketId) : null;
  if (!r || !t || !(t.requesterId === u.id || u.lead || (u.member && t.assigneeId === u.id))) throw new DesignError("That file was not found.");
  if (r.status !== "uploaded" || !r.fileId) throw new DesignError("The source file is not ready yet.");
  const f = await fileById(r.fileId);
  if (!f) throw new DesignError("That file is no longer stored.");
  await db.insert(cdrDownloads).values({ cdrRequestId: r.id, userId: u.id });
  return fileLink(f);
}
