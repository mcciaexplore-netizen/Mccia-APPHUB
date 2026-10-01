"use client";

import { AlertTriangle } from "lucide-react";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="glass w-full max-w-md p-8 text-center">
        <div className="icon-tile mx-auto mb-4 !border-red-tint-line !bg-red-tint !text-brand-red"><AlertTriangle size={18} /></div>
        <h1 className="text-3xl">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">Please try again. If it keeps happening, contact the head admin.</p>
        <button onClick={reset} className="btn btn-primary mt-6">Try again</button>
      </div>
    </main>
  );
}
