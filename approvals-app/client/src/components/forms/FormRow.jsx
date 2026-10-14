/** One line of a form: the label on the left (a red * when required), the input on the right, any error under it. */
export default function FormRow({ label, required, error, children }) {
  return (
    <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:gap-5">
      <label className="pt-1.5 font-bold sm:w-52 sm:shrink-0">{label}{required && <span className="text-red-500"> *</span>}</label>
      <div className="w-full max-w-sm">{children}{error && <p className="mt-1 text-sm text-red-600" role="alert">{error}</p>}</div>
    </div>
  );
}
