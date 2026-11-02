import { reviewByToken } from "@/lib/design/approvals";
import { Badge, formatDateTime } from "@/components/design/ui";
import { ReviewDecision } from "@/components/design/review/review-decision";

export const metadata = { title: "Review your design · MCCIA", robots: { index: false } };

/**
 * The review link emailed to the requester (no sign-in: the token is the key). Shows the design and lets them approve it or ask for
 * changes, once. Expired, withdrawn and already-decided links say so.
 */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await reviewByToken(token);
  if (!r)
    return (
      <div className="ds-card px-6 py-12 text-center">
        <h1 className="text-xl font-bold text-ink">This link is not valid</h1>
        <p className="mt-2 text-sm ds-muted">Check that you opened the whole link from the email, or ask the design team for a new one.</p>
      </div>
    );
  const src = `/api/design/public/review/${token}/file`;
  const mime = r.proof.mime ?? "";
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.8rem] font-bold text-ink">Review your design</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink">
          <span className="font-bold text-[var(--ds-navy)]">{r.ticket.number}</span> — {r.ticket.title}
          <Badge tone="blue">V{r.proof.version}</Badge>
        </p>
      </div>
      <div className="ds-card overflow-hidden">
        {!r.fileAllowed ? (
          <p className="px-6 py-10 text-center text-sm ds-muted">The design is no longer available from this link.</p>
        ) : mime.startsWith("image/") && mime !== "image/vnd.adobe.photoshop" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Design ${r.ticket.number}, version ${r.proof.version}`} className="mx-auto block max-h-[75vh] w-auto max-w-full bg-[#fafafa] object-contain" />
        ) : mime === "application/pdf" ? (
          <iframe src={src} title={`Design ${r.ticket.number}`} className="h-[75vh] w-full border-0" />
        ) : (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-ink">{r.proof.fileName ?? "The design"} cannot be shown in the browser.</p>
            <a href={`${src}?download=1`} className="btn btn-sm ds-btn-navy mt-3">
              Download it
            </a>
          </div>
        )}
        {r.proof.note && <p className="border-t border-[var(--ds-line)] px-5 py-3 text-sm text-ink"><span className="ds-label mr-2">Note from the designer</span>{r.proof.note}</p>}
      </div>

      {r.status === "pending" ? (
        <ReviewDecision token={token} expiresAt={formatDateTime(r.expiresAt)} />
      ) : (
        <div className="ds-card px-6 py-8 text-center">
          <h2 className="text-lg font-bold text-ink">
            {r.status === "expired"
              ? "This link has expired"
              : r.status === "revoked"
                ? "This link was withdrawn"
                : r.status === "approved"
                  ? "You already approved this design"
                  : "You already requested changes"}
          </h2>
          <p className="mt-2 text-sm ds-muted">
            {r.status === "expired"
              ? "The review closed after two days. Ask the design team if you still need changes."
              : r.status === "revoked"
                ? "The design team sent a newer version or withdrew this one. Check your email for the latest link."
                : r.decidedAt
                  ? `Recorded on ${formatDateTime(r.decidedAt)} IST.`
                  : ""}
          </p>
          {r.comment && <p className="mx-auto mt-3 max-w-lg rounded-lg bg-[var(--ds-grey-tint)] px-4 py-2 text-left text-sm text-ink">{r.comment}</p>}
        </div>
      )}
    </div>
  );
}
