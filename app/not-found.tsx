import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-brand-aurora px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo size="lg" priority />
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-card p-8 text-center shadow-glow-cyan">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue/15 mb-4">
            <AlertCircle className="h-6 w-6 text-brand-cyan" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            404 — page not found
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or has moved.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
