import { fileUrl } from "../../services/submissionService.js";
import { fmtDate, fmtDateTime, inr } from "../../utils/format.js";

const show = (f) => {
  if (f.type === "money" || f.type === "computed") return typeof f.value === "number" ? inr(f.value) : f.value === null ? "Not set" : f.value;
  if (f.type === "date") return fmtDate(f.value);
  if (f.type === "datetime") return fmtDateTime(f.value);
  return f.value;
};

/** Everything that was submitted, label by label, with each attached file as a download link. */
export default function SubmissionFields({ submission }) {
  return (
    <dl className="mb-8 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[13rem_1fr]">
      <dt className="font-bold">Submitted by</dt>
      <dd>{submission.submitter}</dd>
      {submission.fields.map((f) => (
        <div key={f.key} className="contents">
          <dt className="font-bold">{f.label}</dt>
          <dd className="whitespace-pre-wrap break-words">{show(f) || "—"}</dd>
        </div>
      ))}
      {submission.files.map((f) => (
        <div key={f.key} className="contents">
          <dt className="font-bold">{f.label}</dt>
          <dd>{f.file ? <a className="text-brand-dark underline" href={fileUrl(f.file.id)}>{f.file.original_name}</a> : "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
