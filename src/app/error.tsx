"use client";
import { ServiceError } from "@/components/service-error";
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ServiceError retry={retry} reference={error.digest} />;
}
