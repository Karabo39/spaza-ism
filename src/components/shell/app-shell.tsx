"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ModuleGate } from "./module-gate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const contentRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [pathname]);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <div className="app-shell flex h-dvh overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main
          ref={contentRef}
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6 lg:px-8"
        >
          <ModuleGate>{children}</ModuleGate>
        </main>
      </div>
    </div>
  );
}
