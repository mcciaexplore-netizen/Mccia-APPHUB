import { api } from "./http.js";

export const listSubmissions = ({ view, modules = "", q = "" }) => api("GET", `/api/submissions?view=${view}&modules=${modules}&q=${encodeURIComponent(q)}`);
export const getSubmission = (id) => api("GET", `/api/submissions/${id}`);
/** `formData` carries the form fields as `payload` plus any attached files. */
export const createSubmission = (module, formData) => api("POST", `/api/submissions/${module}`, formData);
export const resubmitSubmission = (id, formData) => api("PUT", `/api/submissions/${id}`, formData);
/** action is "approve", "reject" or "more_info". */
export const decideSubmission = (id, action, comment) => api("POST", `/api/submissions/${id}/action`, { action, comment });
export const getCounts = () => api("GET", "/api/counts");
export const fileUrl = (fileId) => `/api/files/${fileId}`;
