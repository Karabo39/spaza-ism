import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BackButton } from "./back-button";
export function PublicNavigation() {
  return (
    <nav
      aria-label="Page navigation"
      className="absolute left-4 top-3 z-20 flex items-center gap-3"
    >
      <BackButton />
      <Link
        href="/"
        aria-label="Spaza ISM home"
        className="focus-ring flex items-center gap-2 rounded-md px-2 py-2 text-sm"
      >
        <ShieldCheck className="size-5 text-primary-hover" />
        Spaza ISM
      </Link>
    </nav>
  );
}
