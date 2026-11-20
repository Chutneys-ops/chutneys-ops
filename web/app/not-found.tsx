import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";

// Our own 404. Next.js's built-in one uses inline styles, which the Content
// Security Policy (rightly) blocks, so it rendered unstyled.
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-white p-6">
        <div className="flex items-center gap-3">
          <LogoMark size="lg" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold">Page not found</h1>
            <p className="text-sm text-muted">It may have moved, or you may not have access to it.</p>
          </div>
        </div>
        <Link
          href="/home"
          className="min-h-12 content-center rounded-xl bg-primary px-4 text-center font-semibold text-white hover:bg-primary-dark"
        >
          Go to Home
        </Link>
      </div>
    </main>
  );
}
