import type { ReactNode } from "react";
import { PublicNavigation } from "@/components/shell/public-navigation";
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicNavigation />
      {children}
    </>
  );
}
