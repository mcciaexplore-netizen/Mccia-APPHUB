import { useState } from "react";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { PageTitle } from "../components/ui.jsx";

const SECTIONS = [
  { kind: "branches", title: "Branches" },
  { kind: "categories", title: "Expense categories" },
  { kind: "hr_categories", title: "HR categories" },
  { kind: "publication_types", title: "Types of publication" },
  { kind: "publications", title: "Publications" },
  { kind: "employees", title: "Employees (the Name list on the forms)" },
];

function Section({ kind, title }) {
  const { config, toast, loadConfig } = useApp();
  const items = config.lists[kind];
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const add = async (e) => {
    e.preventDefault();
    try {
      await api("POST", `/api/masters/${kind}`, { name, ...(kind === "publications" ? { publication_type: Number(extra) } : {}), ...(kind === "employees" ? { email: extra } : {}) });
      toast("ok", "Added");
      setName(""); setExtra("");
      await loadConfig();
    } catch (ex) { toast("error", ex.message); }
  };
  return (
    <section className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-base font-bold">{title} <span className="font-normal text-gray-500">({items.length})</span></h2>
      <form onSubmit={add} className="mb-3 flex flex-wrap gap-2">
        {kind === "publications" && (
          <select className="field w-44" value={extra} onChange={(e) => setExtra(e.target.value)} required aria-label="Type of publication">
            <option value="">-Type-</option>{config.lists.publication_types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <input className="field w-52" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required aria-label={`New ${title}`} />
        {kind === "employees" && <input type="email" className="field w-52" placeholder="Email" value={extra} onChange={(e) => setExtra(e.target.value)} required aria-label="Email" />}
        <button className="btn btn-primary">Add</button>
      </form>
      <ul className="max-h-44 overflow-y-auto text-sm text-gray-700">
        {items.length === 0 && <li className="text-gray-500">None yet.</li>}
        {items.map((i) => <li key={i.id} className="border-t border-gray-100 py-1">{i.name}{i.email ? ` · ${i.email}` : ""}</li>)}
      </ul>
    </section>
  );
}

export default function MastersPage() {
  return (
    <>
      <PageTitle title="Masters" intro="The lists behind the dropdowns. Add a branch, a category or a publication here and it appears on the forms straight away." />
      <div className="grid gap-5 lg:grid-cols-2">{SECTIONS.map((s) => <Section key={s.kind} {...s} />)}</div>
    </>
  );
}
