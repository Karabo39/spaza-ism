"use client";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

export function ServiceError({ retry, reference }: { retry: () => void; reference?: string }) {
  return <main className="mx-auto flex min-h-[70svh] max-w-lg flex-col justify-center gap-5 px-6 py-12">
    <BrandLogo className="max-w-full" />
    <h1 className="text-xl font-semibold">We couldn’t load this page</h1>
    <p className="text-sm text-muted-foreground">Check your connection and try again. If you were saving a sale or payment, check its history before entering it again.</p>
    {reference && <p className="text-xs text-muted">Support reference: {reference.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}</p>}
    <div className="flex flex-wrap gap-3"><Button onClick={retry}>Try again</Button><Button asChild variant="secondary"><Link href="/">Go home</Link></Button></div>
  </main>;
}
