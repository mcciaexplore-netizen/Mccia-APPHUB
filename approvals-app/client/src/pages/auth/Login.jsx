import { useState } from "react";
import { useApp } from "../../context/AppContext.jsx";

export default function Login() {
  const { signIn } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try { await signIn(username, password); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-side p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="text-2xl font-black tracking-wide">MCCIA</div>
          <div className="text-xs uppercase tracking-widest text-gray-500">Approvals</div>
        </div>
        <label className="mb-1 block font-bold" htmlFor="u">Username</label>
        <input id="u" className="field mb-4" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required />
        <label className="mb-1 block font-bold" htmlFor="p">Password</label>
        <input id="p" type="password" className="field mb-4" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
