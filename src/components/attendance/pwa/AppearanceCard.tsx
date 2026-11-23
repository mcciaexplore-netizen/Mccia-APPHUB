"use client";

import { Moon, Sun } from "lucide-react";
import { Card } from "../ui";
import { setThemePref, useTheme } from "./Theme";

/** Profile → Appearance: the "Dark mode" switch (kept on this device), and going back to the device's own setting. */
export function AppearanceCard() {
  const { pref, dark, systemDark } = useTheme();
  return (
    <Card title="Appearance" icon={dark ? Moon : Sun} iconTone={dark ? "purple" : "orange"}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-gray-900">
            {dark ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />} Dark mode
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {pref ? `Your choice on this device. ` : `Following this device's setting (${systemDark ? "dark" : "light"}). `}
            {pref && (
              <button type="button" className="att-link-btn" onClick={() => setThemePref(null)}>
                Use the device setting
              </button>
            )}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={() => setThemePref(dark ? "light" : "dark")} className="att-switch">
          <span className="att-switch-knob">{dark ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}</span>
        </button>
      </div>
    </Card>
  );
}
