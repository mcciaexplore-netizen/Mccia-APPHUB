import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api.js";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import ListPage from "./pages/ListPage.jsx";
import FormPage from "./pages/FormPage.jsx";
import DetailPage from "./pages/DetailPage.jsx";
import BudgetsPage from "./pages/BudgetsPage.jsx";
import MastersPage from "./pages/MastersPage.jsx";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined while checking, null when signed out
  const [config, setConfig] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((kind, message) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadConfig = useCallback(async () => setConfig(await api("GET", "/api/config")), []);

  useEffect(() => {
    api("GET", "/api/me")
      .then(async (r) => { setUser(r.user); await loadConfig(); })
      .catch(() => setUser(null));
  }, [loadConfig]);

  const signIn = async (username, password) => {
    const r = await api("POST", "/api/login", { username, password });
    setUser(r.user);
    await loadConfig();
  };
  const signOut = async () => { await api("POST", "/api/logout"); setUser(null); setConfig(null); };

  let body;
  if (user === undefined) body = <p className="p-8 text-gray-500">Loading…</p>;
  else if (!user) body = <Login onSignIn={signIn} />;
  else if (!config) body = <p className="p-8 text-gray-500">Loading…</p>;
  else {
    body = (
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/list" element={<ListPage />} />
          <Route path="/new/:module" element={<FormPage />} />
          <Route path="/edit/:id" element={<FormPage />} />
          <Route path="/submission/:id" element={<DetailPage />} />
          <Route path="/budgets" element={user.can_manage ? <BudgetsPage /> : <Navigate to="/" />} />
          <Route path="/masters" element={user.can_manage ? <MastersPage /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    );
  }

  return (
    <Ctx.Provider value={{ user, config, toast, signOut, loadConfig }}>
      {body}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[92vw] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded border-l-4 bg-white px-4 py-3 shadow-lg ${t.kind === "error" ? "border-red-500" : "border-brand"}`}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
