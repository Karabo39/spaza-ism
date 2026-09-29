export type DeliveryItem = {
  id: string;
  product_id: string;
  description: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  ordered_quantity: number;
  delivery_quantity: number;
  remarks: string;
};
export type DeliverySnapshot = {
  business_name: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  store_name: string;
  order_id: string;
  order_reference: string;
  invoice_reference: string;
  customer_id: string;
  customer_name: string;
  company_name: string;
  customer_code: string;
  delivery_address: string;
  contact_number: string;
  items: DeliveryItem[];
};
export type Delivery = {
  id: string;
  invoice_id: string;
  business_id: string;
  store_id: string;
  reference: string;
  status: string;
  original_date: string;
  scheduled_date: string;
  snapshot: DeliverySnapshot;
  driver_name: string | null;
  vehicle_registration: string | null;
  delivery_reference: string | null;
  comments: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  received_by: string | null;
  receiver_phone: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  version: number;
};
export type DeliveryDetail = {
  order: {
    id: string;
    reference: string;
    status: string;
    required: boolean;
    details: {
      date?: string;
      address?: string;
      phone?: string;
      notes?: string;
    };
    version: number;
  };
  customer: { name: string; phone: string | null; address: string | null };
  payment_status: string | null;
  goods_issued_at: string | null;
  invoice_id: string | null;
  delivery: Delivery | null;
  timezone: string;
};
export type DeliveryRow = {
  id: string;
  sequence: number;
  reference: string;
  status: string;
  scheduled_date: string;
  original_date: string;
  version: number;
  driver_name: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  order_id: string;
  order_reference: string;
  customer_name: string;
  contact_number: string;
  delivery_address: string;
};
export const CANCELLATION_REASONS = [
  "Customer Rejected Order",
  "Customer No Longer Wants Order",
  "Customer Unavailable",
  "Incorrect Delivery Address",
  "Order Damaged",
  "Items Unavailable/Out of Stock",
  "Duplicate Order",
  "Customer Cancelled Order",
  "Payment Issue",
  "Delivery Area Not Supported",
  "Delivery Attempt Failed",
  "Order Expired",
  "Other",
] as const;
export const DELIVERY_TERMINAL = ["DELIVERED", "CANCELLED"];
