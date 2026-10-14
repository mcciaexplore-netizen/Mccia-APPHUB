/** The little messages in the bottom corner: a teal edge for good news, red for errors. */
export default function Toaster({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[92vw] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded border-l-4 bg-white px-4 py-3 shadow-lg ${t.kind === "error" ? "border-red-500" : "border-brand"}`}>{t.message}</div>
      ))}
    </div>
  );
}
