/**
 * Checks a form before it is sent: required fields are filled and money fields hold an amount. The server checks everything again;
 * this only saves a round trip and points at the field. `wrongForm` is the "use the other Expenditure form" notice, when there is one.
 */
export function validateForm(mod, values, wrongForm) {
  const errors = {};
  for (const f of mod.fields) {
    if (f.required && (values[f.key] === "" || values[f.key] === undefined)) errors[f.key] = `${f.label} is required.`;
    if (f.type === "money" && values[f.key] !== "" && !(Number(values[f.key]) >= 0)) errors[f.key] = `${f.label} must be an amount.`;
  }
  if (wrongForm) errors[mod.amountKey] = wrongForm.text;
  return errors;
}

/**
 * Which Expenditure form an amount belongs on. Returns the notice (and the form to open instead) when it is on the wrong one, else null.
 * The limit comes from the server's config, and exactly the limit counts as "and above".
 */
export function wrongExpenditureForm(moduleKey, amount, threshold) {
  if (amount == null) return null;
  if (moduleKey === "expenditure" && amount >= threshold) return { text: "Amounts of ₹10,000 and above must be submitted through DG Approval: Expenditure.", to: "/new/dg_expenditure" };
  if (moduleKey === "dg_expenditure" && amount > 0 && amount < threshold) return { text: "Amounts below ₹10,000 must be submitted through the Expenditure form.", to: "/new/expenditure" };
  return null;
}
