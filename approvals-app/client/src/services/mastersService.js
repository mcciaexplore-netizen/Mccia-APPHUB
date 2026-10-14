import { api } from "./http.js";

/** kind: branches, categories, hr_categories, publication_types, publications or employees. */
export const addMaster = (kind, body) => api("POST", `/api/masters/${kind}`, body);
