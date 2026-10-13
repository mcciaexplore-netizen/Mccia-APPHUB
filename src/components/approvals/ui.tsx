"use client";

/** Small pieces shared by the module's admin screens. */

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function ActiveToggle({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onToggle} disabled={disabled} title={active ? "Click to deactivate" : "Click to activate"}
      className={`badge ${active ? "badge-green" : "badge-neutral"} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input max-w-xs" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />;
}
