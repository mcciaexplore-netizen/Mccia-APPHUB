import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { PageTitle } from "../components/ui.jsx";

export default function Home() {
  const { user, config } = useApp();
  const [counts, setCounts] = useState({ pending: {}, info: 0 });
  useEffect(() => { api("GET", "/api/counts").then(setCounts).catch(() => {}); }, []);
  const mods = Object.values(config.modules);
  const pending = Object.entries(counts.pending);

  return (
    <>
      <PageTitle title={`Welcome, ${user.name}`} intro="MCCIA internal approvals: expenditure, DG approvals, HR requests, reimbursements and events." />
      {user.role === "staff" ? (
        <>
          {counts.info > 0 && (
            <Link to="/list?view=mine" className="mb-6 block max-w-2xl rounded border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
              <b>{counts.info}</b> of your requests need more information. Open them to answer.
            </Link>
          )}
          <h2 className="mb-3 text-base font-bold">Submit a request</h2>
          <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
            {mods.map((m) => (
              <Link key={m.key} to={`/new/${m.key}`} className="rounded border border-gray-200 p-4 hover:border-brand hover:bg-teal-50">
                <div className="font-bold">{m.label}</div>
                <div className="text-xs text-gray-500">Open the form</div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-3 text-base font-bold">Waiting for you</h2>
          {pending.length === 0 ? (
            <p className="text-gray-500">Nothing is waiting for your decision.</p>
          ) : (
            <ul className="max-w-xl divide-y rounded border border-gray-200">
              {pending.map(([k, n]) => (
                <li key={k}>
                  <Link to={`/list?view=pending&modules=${k}`} className="flex items-center justify-between px-4 py-3 hover:bg-teal-50">
                    <span>{config.modules[k].label}</span>
                    <span className="rounded-full bg-yellow-400 px-2 text-xs font-bold">{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
