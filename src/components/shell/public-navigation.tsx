import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND_NAME } from "@/lib/brand";
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
        aria-label={`${BRAND_NAME} home`}
        className="focus-ring flex items-center gap-2 rounded-md px-2 py-2 text-sm"
      >
        <BrandLogo variant="horizontal" className="w-44" />
      </Link>
    </nav>
  );
}
