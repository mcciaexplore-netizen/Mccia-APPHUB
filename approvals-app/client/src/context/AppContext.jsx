import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Toaster from "../components/common/Toaster.jsx";
import * as auth from "../services/authService.js";
import { getConfig } from "../services/configService.js";

const AppContext = createContext(null);

/** Who is signed in, the form definitions and lists, and the toast messages. Everything the pages share. */
export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined while checking the session, null when signed out
  const [config, setConfig] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((kind, message) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadConfig = useCallback(async () => setConfig(await getConfig()), []);

  useEffect(() => {
    auth.getMe()
      .then(async (r) => { setUser(r.user); await loadConfig(); })
      .catch(() => setUser(null));
  }, [loadConfig]);

  const signIn = useCallback(async (username, password) => {
    const r = await auth.login(username, password);
    setUser(r.user);
    await loadConfig();
  }, [loadConfig]);

  const signOut = useCallback(async () => {
    await auth.logout();
    setUser(null);
    setConfig(null);
  }, []);

  const value = useMemo(() => ({ user, config, toast, signIn, signOut, loadConfig }), [user, config, toast, signIn, signOut, loadConfig]);
  return (
    <AppContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} />
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
