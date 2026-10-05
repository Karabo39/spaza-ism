const messages: Record<string, string> = {
  SHOP_UNAVAILABLE: "This store is not taking online orders yet.",
  ORDER_NOT_FOUND:
    "This private order link is invalid. Open the complete link from your confirmation.",
  PRODUCT_UNAVAILABLE:
    "An item is no longer available in the requested quantity. Refresh the products and adjust your basket.",
  REQUEST_CONFLICT:
    "Your previous order attempt has different details. Check its tracking link before placing another order.",
  TOO_MANY_ORDERS: "Too many order attempts. Please try again later.",
  SHOP_BUSY: "This store is busy. Please contact the store or try again later.",
};
export class CustomerRequestError extends Error {
  constructor(
    message: string,
    public definitive: boolean,
  ) {
    super(message);
  }
}
export async function customerRequest<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/customer-ordering`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    },
  );
  const result = await response.json();
  if (!response.ok || result.error)
    throw new CustomerRequestError(
      messages[result.error] ||
        "Unable to complete this request. Check your details and try again.",
      response.status === 400 && result.error !== "REQUEST_CONFLICT",
    );
  return result.data as T;
}
export function newOrderSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
