import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="glass w-full max-w-md p-8 text-center">
        <div className="icon-tile mx-auto mb-4"><SearchX size={18} /></div>
        <h1 className="text-3xl">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you are looking for does not exist.</p>
        <Link href="/" className="btn btn-primary mt-6">Back to App Hub</Link>
      </div>
    </main>
  );
}
