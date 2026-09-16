"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/format";
export function WarehouseEdit({
  id,
  name,
  code,
  canDisable = false,
  canEdit = true,
}: {
  id: string;
  name: string;
  code: string;
  canDisable?: boolean;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const { online } = useOffline();
  const [open, setOpen] = useState(false);
  const [newName, setName] = useState(name);
  const [newCode, setCode] = useState(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <div>
      <Button
        variant="primary"
        size="sm"
        disabled={!online || busy}
        onClick={() => {
          setName(name);
          setCode(code);
          setError("");
          setOpen(!open);
        }}
      >
        {canEdit ? "Edit warehouse details" : "Manage warehouse"}
      </Button>
      {open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!online || lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const { error } = await createClient().rpc("update_location", {
                p_store: id,
                p_name: newName.trim(),
                p_code: newCode.trim(),
              });
              if (error) throw error;
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError(friendlyError((e as Error).message));
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          {canEdit && (
            <>
              <Label htmlFor={`warehouse-name-${id}`}>Warehouse name</Label>
              <Input
                id={`warehouse-name-${id}`}
                required
                maxLength={120}
                value={newName}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
              <Label htmlFor={`warehouse-code-${id}`}>
                Warehouse code (optional)
              </Label>
              <Input
                id={`warehouse-code-${id}`}
                maxLength={30}
                value={newCode}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button
                loading={busy}
                type="submit"
                disabled={!online || !newName.trim()}
              >
                Save warehouse details
              </Button>
            )}
            <Button
              variant="primary"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            {canDisable && (
              <Button
                type="button"
                variant="danger"
                disabled={!online || busy}
                onClick={async () => {
                  if (!online || lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setError("");
                  try {
                    const { error } = await createClient().rpc(
                      "disable_warehouse",
                      { p_store: id },
                    );
                    if (error) throw error;
                    setOpen(false);
                    router.refresh();
                  } catch (e) {
                    setError(friendlyError((e as Error).message));
                  } finally {
                    lock.current = false;
                    setBusy(false);
                  }
                }}
              >
                Disable warehouse
              </Button>
            )}
          </div>
          {canDisable && (
            <p className="text-xs text-muted">
              Disabling hides this warehouse. All product quantities must be
              zero and open transfers must be completed or cancelled. History is
              retained.
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
