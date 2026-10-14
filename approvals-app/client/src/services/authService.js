import { api } from "./http.js";

export const getMe = () => api("GET", "/api/me");
export const login = (username, password) => api("POST", "/api/login", { username, password });
export const logout = () => api("POST", "/api/logout");
