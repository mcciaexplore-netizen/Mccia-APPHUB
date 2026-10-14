import { api } from "./http.js";

/** The five form definitions, the dropdown lists and the ₹10,000 limit. */
export const getConfig = () => api("GET", "/api/config");
