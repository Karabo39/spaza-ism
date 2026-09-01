import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="text-6xl font-bold text-primary">404</p>
      <p className="text-muted">This page could not be found.</p>
      <Button asChild><Link href="/">Back to dashboard</Link></Button>
    </div>
  );
}
