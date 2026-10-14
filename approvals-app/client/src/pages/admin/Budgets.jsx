import { useCallback, useEffect, useState } from "react";
import PageTitle from "../../components/common/PageTitle.jsx";
import { useApp } from "../../context/AppContext.jsx";
import { listBudgets, saveBudget } from "../../services/budgetService.js";
import { inr } from "../../utils/format.js";

/** What is allocated to each branch and category, with what approved requests have used. For people who manage budgets. */
export default function Budgets() {
  const { config, toast } = useApp();
  const { branches, categories } = config.lists;
  const [rows, setRows] = useState(null);
  const [branch, setBranch] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const load = useCallback(() => listBudgets().then(setRows).catch((e) => { setRows([]); toast("error", e.message); }), [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await saveBudget({ branch_id: Number(branch), category_id: Number(category), allocated: Number(amount) });
      toast("ok", "Budget saved");
      setAmount("");
      load();
    } catch (ex) { toast("error", ex.message); }
  };
  const edit = (r) => { setBranch(String(r.branch_id)); setCategory(String(r.category_id)); setAmount(String(r.allocated)); window.scrollTo({ top: 0 }); };

  return (
    <>
      <PageTitle title="Budgets" intro="What is allocated to each branch and category. Available budget on the forms is this amount minus the spend of approved requests." />
      <form onSubmit={save} className="mb-8 flex flex-wrap items-end gap-3 rounded border border-gray-200 p-4">
        <label className="block"><span className="mb-1 block font-bold">Branch</span>
          <select className="field w-52" value={branch} onChange={(e) => setBranch(e.target.value)} required><option value="">-Select-</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="block"><span className="mb-1 block font-bold">Category</span>
          <select className="field w-64" value={category} onChange={(e) => setCategory(e.target.value)} required><option value="">-Select-</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block"><span className="mb-1 block font-bold">Allocated (₹)</span>
          <input type="number" min="0" step="0.01" className="field w-40" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        <button className="btn btn-primary">Save budget</button>
      </form>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs text-gray-600"><tr><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Used (approved)</th><th className="px-3 py-2 text-right">Available</th><th /></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No budgets set yet.</td></tr>}
            {rows?.map((r) => (
              <tr key={`${r.branch_id}-${r.category_id}`} className="border-t border-gray-100">
                <td className="px-3 py-2">{r.branch}</td><td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2 text-right">{inr(r.allocated)}</td><td className="px-3 py-2 text-right">{inr(r.used)}</td>
                <td className={`px-3 py-2 text-right ${r.allocated - r.used < 0 ? "font-bold text-red-600" : ""}`}>{inr(r.allocated - r.used)}</td>
                <td className="px-3 py-2 text-right"><button className="text-brand-dark underline" onClick={() => edit(r)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
