const STYLE = {
  done: "border-green-300 bg-green-50 text-green-800",
  current: "border-yellow-300 bg-yellow-50 text-yellow-800",
  rejected: "border-red-300 bg-red-50 text-red-800",
  later: "border-gray-200 text-gray-500",
};

/** The route a request takes (Shrotri → Director General), showing who has approved, who it waits for and who is still to come. */
export default function StageProgress({ stages }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      {stages.map((s, i) => (
        <span key={s.username} className="flex items-center gap-2">
          {i > 0 && <span className="text-gray-400">→</span>}
          <span className={`rounded-full border px-3 py-1 ${STYLE[s.state] ?? STYLE.later}`}>{s.name} {s.state === "done" ? "✓" : ""}</span>
        </span>
      ))}
    </div>
  );
}
