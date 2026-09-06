"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Go back"
      className="focus-ring flex shrink-0 items-center gap-1.5 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-surface-2"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
    >
      <ArrowLeft className="size-4" />
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
