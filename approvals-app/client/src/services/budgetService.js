import { api } from "./http.js";

/** Allocated, used and available for one branch and category. `exclude` leaves one request out (the one being edited). */
export const lookupBudget = (branch, category, exclude) => api("GET", `/api/budget?branch=${branch}&category=${category}${exclude ? `&exclude=${exclude}` : ""}`);
export const listBudgets = () => api("GET", "/api/budgets");
export const saveBudget = (body) => api("PUT", "/api/budgets", body);
