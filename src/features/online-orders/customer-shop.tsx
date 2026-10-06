"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ShoppingBag,
  ArrowRight,
  Package,
  MapPin,
  Truck,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerRequestError, customerRequest, newOrderSecret } from "./api";
import type { Catalog, OnlineProduct } from "./types";
import { money } from "@/lib/format";

export function CustomerShop({ link }: { link: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<
      { product: OnlineProduct; quantity: number }[]
    >([]),
    [checkout, setCheckout] = useState(false),
    [busy, setBusy] = useState(false);
  const [fulfilment, setFulfilment] = useState("COLLECTION"),
    [payment, setPayment] = useState("BANK_TRANSFER");
  const lock = useRef(false),
    pending = useRef<Record<string, unknown> | null>(null);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = sessionStorage.getItem(`online-pending:${link}`);
        if (saved) {
          pending.current = JSON.parse(saved);
          setRecovering(true);
        }
      } catch {
        sessionStorage.removeItem(`online-pending:${link}`);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [link]);
  async function recover() {
    if (lock.current || !pending.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await customerRequest<{ order_id: string }>(
        pending.current,
      );
      const token = pending.current.secret;
      sessionStorage.removeItem(`online-pending:${link}`);
      router.push(`/shop/${link}/track/${result.order_id}#${token}`);
    } catch (e) {
      if (e instanceof CustomerRequestError && e.definitive) {
        pending.current = null;
        setRecovering(false);
        sessionStorage.removeItem(`online-pending:${link}`);
      }
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      customerRequest<Catalog>(
        { action: "catalog", link, search },
        controller.signal,
      )
        .then((data) => {
          setCatalog(data);
          setFulfilment((f) =>
            f === "COLLECTION" && !data.shop.collection_enabled
              ? "DELIVERY"
              : f === "DELIVERY" && !data.shop.delivery_enabled
                ? "COLLECTION"
                : f,
          );
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [link, search]);
  const shop = catalog?.shop;
  const subtotal = cart.reduce(
    (n, l) => n + Math.round(l.product.price * l.quantity * 100) / 100,
    0,
  );
  const fee = fulfilment === "DELIVERY" ? Number(shop?.delivery_fee || 0) : 0;
  const total =
    Math.round(
      (subtotal + fee) * (1 + Number(shop?.tax_percent || 0) / 100) * 100,
    ) / 100;
  function quantity(product: OnlineProduct, delta: number) {
    setCart((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      const q = (existing?.quantity || 0) + delta;
      return [
        ...lines.filter((l) => l.product.id !== product.id),
        ...(q > 0 ? [{ product, quantity: Math.min(q, 10000) }] : []),
      ];
    });
  }
  async function place(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !shop || cart.length === 0) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      // Persist the exact payload before sending. A lost response can be retried without a duplicate order.
      const key = `online-pending:${link}`;
      if (!pending.current) {
        const saved = sessionStorage.getItem(key);
        pending.current = saved
          ? JSON.parse(saved)
          : {
              action: "place",
              link,
              request: crypto.randomUUID(),
              secret: newOrderSecret(),
              contact: {
                name: form.get("name"),
                phone: form.get("phone"),
                email: form.get("email"),
                address: form.get("address"),
                notes: form.get("notes"),
                email_notifications: form.get("notifications") === "on",
              },
              items: cart.map((l) => ({
                product_id: l.product.id,
                quantity: l.quantity,
              })),
              fulfilment,
              payment,
              date: form.get("date"),
              website: form.get("website"),
            };
        sessionStorage.setItem(key, JSON.stringify(pending.current));
      }
      const result = await customerRequest<{ order_id: string }>(
        pending.current!,
      );
      const token = pending.current!.secret;
      sessionStorage.removeItem(key);
      router.push(`/shop/${link}/track/${result.order_id}#${token}`);
    } catch (e) {
      if (e instanceof CustomerRequestError && e.definitive) {
        pending.current = null;
        setRecovering(false);
        sessionStorage.removeItem(`online-pending:${link}`);
      } else setRecovering(true);
      setError(
        e instanceof Error
          ? e.message
          : "Unable to confirm your order. Retry with the same details.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary p-3 text-white">
              <ShoppingBag className="size-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                POS INVENTORY · Customer ordering
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                {shop?.business || "Your local store"}
              </h1>
            </div>
          </div>
          <Button
            onClick={() => setCheckout((v) => !v)}
            disabled={!cart.length}
          >
            <ShoppingBag className="mr-2 size-4" />
            Basket ({cart.reduce((n, l) => n + l.quantity, 0)})
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8">
        {recovering && (
          <div className="mb-5 rounded-xl border border-border bg-surface p-5">
            <p className="mb-3">
              A previous order confirmation is unresolved. Retry those saved
              details before placing another order.
            </p>
            <Button disabled={busy} onClick={recover}>
              {busy ? "Checking saved order…" : "Recover previous order"}
            </Button>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="mb-5 rounded-xl border border-danger/40 bg-surface p-4"
          >
            {error}
          </p>
        )}
        {shop && (
          <section className="mb-8 rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <p className="text-sm font-medium text-primary">
              Order from {shop.name}
            </p>
            <p className="mt-3 max-w-2xl text-muted">
              Choose your items and reserve them for{" "}
              {shop.collection_enabled && shop.delivery_enabled
                ? "collection or delivery"
                : shop.collection_enabled
                  ? "collection"
                  : "delivery"}
              . Bank transfers are verified by the store before processing.
            </p>
            <div className="mt-5 flex flex-wrap gap-5 text-sm">
              <span className="flex items-center gap-2">
                <MapPin className="size-4" />
                {shop.address || shop.name}
              </span>
              {shop.contact && <span>{shop.contact}</span>}
              {shop.collection_enabled && (
                <span className="flex items-center gap-2">
                  <Package className="size-4" />
                  Store collection
                </span>
              )}
              {shop.delivery_enabled && (
                <span className="flex items-center gap-2">
                  <Truck className="size-4" />
                  Delivery {money(shop.delivery_fee, shop.currency)}
                </span>
              )}
            </div>
          </section>
        )}
        {checkout && shop ? (
          <section className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Your basket</h2>
              <Button variant="ghost" onClick={() => setCheckout(false)}>
                Continue shopping
              </Button>
            </div>
            <div className="my-5 divide-y divide-border">
              {cart.map((l) => (
                <div
                  key={l.product.id}
                  className="flex items-center justify-between gap-3 py-4"
                >
                  <div>
                    <p className="font-medium">
                      {l.product.name}
                      {l.product.variant && ` · ${l.product.variant}`}
                    </p>
                    <p className="text-sm text-muted">
                      {money(l.product.price, shop.currency)} / {l.product.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      aria-label={`Remove one ${l.product.name}`}
                      onClick={() => quantity(l.product, -1)}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span>{l.quantity}</span>
                    <Button
                      variant="ghost"
                      aria-label={`Add one ${l.product.name}`}
                      onClick={() => quantity(l.product, 1)}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={place} className="grid gap-4 sm:grid-cols-2">
              <label>
                Your name
                <Input
                  name="name"
                  required
                  maxLength={150}
                  autoComplete="name"
                />
              </label>
              <label>
                Contact number
                <Input
                  name="phone"
                  required
                  maxLength={80}
                  autoComplete="tel"
                  type="tel"
                />
              </label>
              <label className="sm:col-span-2">
                Email address (optional)
                <Input
                  name="email"
                  maxLength={254}
                  type="email"
                  autoComplete="email"
                />
                <span className="text-xs text-muted">
                  Save your private tracking link if you do not provide an
                  email.
                </span>
              </label>
              <label>
                Collection or delivery
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background p-3"
                  value={fulfilment}
                  onChange={(e) => {
                    setFulfilment(e.target.value);
                    setPayment("BANK_TRANSFER");
                  }}
                >
                  {shop.collection_enabled && (
                    <option value="COLLECTION">Collect from {shop.name}</option>
                  )}
                  {shop.delivery_enabled && (
                    <option value="DELIVERY">Delivery</option>
                  )}
                </select>
              </label>
              <label>
                {fulfilment === "COLLECTION"
                  ? "Collection date"
                  : "Requested delivery date"}
                <Input
                  name="date"
                  type="date"
                  required
                  min={shop.today}
                  defaultValue={shop.today}
                />
              </label>
              {fulfilment === "DELIVERY" && (
                <label className="sm:col-span-2">
                  Full delivery address
                  <Input
                    name="address"
                    required
                    maxLength={1000}
                    autoComplete="street-address"
                  />
                </label>
              )}
              <label className="sm:col-span-2">
                Payment
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background p-3"
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="BANK_TRANSFER">
                    Bank transfer · verified by the store
                  </option>
                  {fulfilment === "COLLECTION" && shop.pay_on_collection && (
                    <option value="PAY_ON_COLLECTION">Pay on collection</option>
                  )}
                </select>
              </label>
              <label className="sm:col-span-2">
                Delivery / order instructions (optional)
                <Input name="notes" maxLength={1000} />
              </label>
              <label className="flex items-center gap-3 sm:col-span-2">
                <input name="notifications" type="checkbox" defaultChecked />
                Email me order and delivery updates
              </label>
              <div aria-hidden="true" className="hidden">
                <input name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <div className="rounded-xl border border-border p-4 sm:col-span-2">
                <p className="text-sm">
                  Items {money(subtotal, shop.currency)} · Delivery{" "}
                  {money(fee, shop.currency)} · Tax {shop.tax_percent}%
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {money(total, shop.currency)}
                </p>
                <p className="mt-2 text-sm text-muted">
                  Final prices and availability are confirmed when your order is
                  placed.{" "}
                  {payment === "PAY_ON_COLLECTION"
                    ? "Collect and pay by the end of your selected collection date. Uncollected unpaid reservations expire."
                    : `Unpaid reservations expire after ${shop.reservation_hours} hours.`}
                </p>
              </div>
              <Button
                type="submit"
                disabled={busy || !cart.length || recovering}
                className="sm:col-span-2"
              >
                {busy ? "Confirming order…" : "Place order"}
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <p className="text-xs text-muted sm:col-span-2">
                If a connection fails, retrying uses the same order details to
                prevent duplicates.
              </p>
            </form>
          </section>
        ) : (
          <>
            <label className="mb-6 block max-w-xl">
              Find a product
              <Input
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product name"
              />
            </label>
            {loading && (
              <p role="status" className="py-8 text-muted">
                Loading products…
              </p>
            )}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {catalog?.products.map((p) => (
                <article
                  key={p.id}
                  className="overflow-hidden rounded-2xl border border-border bg-surface"
                >
                  <div className="flex aspect-[4/3] items-center justify-center bg-background">
                    {p.image_url ? (
                      <Image
                        src={p.image_url}
                        alt={p.name}
                        width={480}
                        height={360}
                        unoptimized
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <Package className="size-12 text-muted/40" />
                    )}
                  </div>
                  <div className="p-5">
                    <h3 className="font-semibold">{p.name}</h3>
                    {p.variant && (
                      <p className="mt-1 text-xs text-muted">
                        {p.variant_group} · {p.variant}
                      </p>
                    )}
                    <p className="mt-2 line-clamp-2 min-h-10 text-sm text-muted">
                      {p.description}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="font-semibold">
                        {money(p.price, shop?.currency || "ZAR")}
                        <span className="ml-1 text-xs font-normal text-muted">
                          /{p.unit}
                        </span>
                      </p>
                      <Button
                        disabled={
                          !p.available ||
                          (cart.length >= 50 &&
                            !cart.some((l) => l.product.id === p.id))
                        }
                        onClick={() => {
                          quantity(p, 1);
                          toast.success(`${p.name} added to your basket`);
                        }}
                      >
                        {p.available ? "Add" : "Unavailable"}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {catalog?.next && (
              <Button
                className="mt-6"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const next = await customerRequest<Catalog>({
                      action: "catalog",
                      link,
                      search,
                      after: catalog.next,
                    });
                    setCatalog((c) =>
                      c
                        ? {
                            ...next,
                            products: [...c.products, ...next.products],
                          }
                        : next,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                More products
              </Button>
            )}
            {catalog && !catalog.products.length && !loading && (
              <p className="py-10 text-muted">
                No online products are available. Please contact the store.
              </p>
            )}
          </>
        )}
      </div>
      <footer className="mt-10 border-t border-border px-5 py-6 text-center text-xs text-muted">
        Powered by POS INVENTORY · Your private order link gives access only to
        your order.
      </footer>
    </main>
  );
}
