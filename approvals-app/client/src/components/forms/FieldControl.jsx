import { fileUrl } from "../../services/submissionService.js";
import { fmtDate, fmtDateTime } from "../../utils/format.js";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The input for one form field, chosen by the field's type (the types come from the server's form definitions).
 * `computedText` is what a read-only budget field shows; `openedAt` is the moment the form was opened (the auto "Date").
 */
export default function FieldControl({ field: f, value, values, setValue, error, lists, files, setFile, detail, openedAt, computedText, employeeEmail }) {
  const bad = error ? "!border-red-500" : "";
  const change = (e) => setValue(f.key, e.target.value);

  switch (f.type) {
    case "text":
      return <input className={`field ${bad}`} value={value} onChange={change} maxLength={200} />;
    case "textarea":
      return <textarea className={`field !h-24 ${bad}`} value={value} onChange={change} maxLength={4000} />;
    case "email":
      return f.auto
        ? <input className="field" readOnly value={employeeEmail} />
        : <input type="email" className={`field ${bad}`} value={value} onChange={change} maxLength={200} />;
    case "datetime":
      return <input className="field" readOnly value={fmtDateTime(detail?.data[f.key] ?? openedAt)} />;
    case "number":
      return <input type="number" min="0" step="1" className={`field ${bad}`} value={value} onChange={change} />;
    case "money":
      return (
        <div className="flex">
          <input inputMode="decimal" type="number" min="0" step="0.01" placeholder="0.00" className={`field rounded-r-none ${bad}`} value={value} onChange={change} />
          <span className="grid min-w-9 place-items-center rounded-r border border-l-0 border-gray-300 bg-gray-100 px-2">₹</span>
        </div>
      );
    case "date":
      return (
        <>
          <input type="date" className={`field ${bad}`} value={value} max={f.key === "tax_invoice_date" ? today() : undefined} onChange={change} />
          {value && <span className="text-xs text-gray-500">{fmtDate(value)}</span>}
        </>
      );
    case "select": {
      const all = lists[f.source] ?? [];
      // A dependent list (Publication) only offers what belongs to the chosen parent (Type of Publication).
      const options = f.dependsOn ? all.filter((o) => String(o.publication_type) === String(values[f.dependsOn])) : all;
      return (
        <select
          className={`field ${bad}`} value={value} disabled={f.dependsOn && !values[f.dependsOn]}
          onChange={(e) => { setValue(f.key, e.target.value); if (f.key === "publication_type") setValue("publication", ""); }}
        >
          <option value="">-Select-</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      );
    }
    case "file": {
      const existing = detail?.files.find((x) => x.key === f.key)?.file;
      return (
        <>
          <input
            type="file" className="field !p-1" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setFile(f.key, e.target.files?.[0] ?? null)}
          />
          {existing && !files[f.key] && (
            <p className="mt-1 text-xs text-gray-500">Current file: <a className="underline" href={fileUrl(existing.id)}>{existing.original_name}</a> (kept unless you choose another)</p>
          )}
        </>
      );
    }
    case "computed":
      return <input className={`field ${computedText.negative ? "!text-red-600 font-bold" : ""}`} readOnly value={computedText.text} placeholder="Auto" />;
    default:
      return null;
  }
}
