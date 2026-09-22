"use client";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { ComponentProps } from "react";

const beforeSend: NonNullable<
  ComponentProps<typeof SpeedInsights>["beforeSend"]
> = (event) => {
  const url = new URL(event.url);
  // Do not send search terms, cursors, invitation tokens or record identifiers.
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "[id]",
  );
  return { ...event, url: url.toString() };
};
export function PerformanceInsights() {
  return <SpeedInsights beforeSend={beforeSend} />;
}
