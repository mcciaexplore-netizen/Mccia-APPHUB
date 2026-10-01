"use client";

import { useMemo, useState } from "react";
import { ICON_NAMES } from "@/lib/icons";
import { Icon } from "@/components/Icon";

export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => ICON_NAMES.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())), [q]);
  return (
    <div>
      <input className="input mb-2 !py-2 text-sm" placeholder="Search icons" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid max-h-40 grid-cols-6 gap-1.5 overflow-y-auto rounded-md border border-line bg-white p-2 sm:grid-cols-8" role="listbox" aria-label="Icon">
        {list.map((n) => (
          <button
            type="button" key={n} title={n} role="option" aria-selected={value === n} onClick={() => onChange(n)}
            className={`grid h-9 place-items-center rounded-sm border transition-all duration-200 ${
              value === n ? "border-primary bg-blue-tint text-primary" : "border-transparent text-muted hover:bg-blue-tint hover:text-primary"
            }`}
          >
            <Icon name={n} />
          </button>
        ))}
        {list.length === 0 && <p className="col-span-full p-2 text-xs text-subtle">No icons match.</p>}
      </div>
    </div>
  );
}
