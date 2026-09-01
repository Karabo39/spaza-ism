"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerPicker } from "./customer-picker";

export function NewCustomerButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><UserPlus className="size-4" /> New customer</Button>
      <CustomerPicker open={open} onOpenChange={setOpen} onSelect={(c) => router.push(`/credit/${c.customer_id}`)} />
    </>
  );
}
