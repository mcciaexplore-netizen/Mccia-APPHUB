/** Every address in the app, in one place. */
export const ROUTES = {
  home: "/",
  newRequest: (module) => `/new/${module}`,
  edit: (id) => `/edit/${id}`,
  submission: (id) => `/submission/${id}`,
  list: (view, modules = "") => `/list?view=${view}${modules ? `&modules=${modules}` : ""}`,
  budgets: "/budgets",
  masters: "/masters",
};

/** The two modules that make up "Expenses" in the menus. */
export const EXPENSE_MODULES = "expenditure,dg_expenditure";
