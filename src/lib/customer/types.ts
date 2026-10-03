export type CatalogEvent = {
  id: string;
  slug: string;
  title: string;
  banner_image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_date_confirmed: boolean;
  venue: { name: string; city: string };
  price_range: { min_kobo: number; max_kobo: number } | null;
  sold_out: boolean;
};
export type EventDetail = CatalogEvent & {
  description: string;
  status: "PUBLISHED" | "CANCELLED";
  venue: CatalogEvent["venue"] & {
    address: string;
    latitude: number | null;
    longitude: number | null;
    map_embed_url: string | null;
    directions_url: string | null;
  };
  organizer: { name: string; description: string | null };
  ticket_tiers: {
    id: string;
    name: string;
    price_kobo: number;
    available: number;
    sales_start_at: string | null;
    sales_end_at: string | null;
    state: SaleState;
  }[];
  calendar_links: Record<string, string>;
};
export type SaleState =
  | "OPEN"
  | "COMING_SOON"
  | "CLOSED"
  | "SOLD_OUT"
  | "ENDED"
  | "CANCELLED"
  | "UNCONFIRMED";
export type OrderStatusDTO = {
  order_code: string;
  status:
    | "AWAITING_PAYMENT"
    | "PROOF_SUBMITTED"
    | "NEEDS_RESUBMIT"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "REFUNDED";
  amount_kobo: number;
  event_title: string;
  proof_attempts: number;
  max_resubmissions: number;
  hold_expires_at: string | null;
  can_submit_proof: boolean;
  late_proof_deadline: string | null;
  pending_proof: boolean;
  late_proof_received?: boolean;
  payment_account: {
    bank_name: string;
    account_number: string;
    account_name: string;
  } | null;
  rejection?: { reason_code: string | null; message: string | null };
  tickets?: {
    ticket_id: string;
    tier_name: string;
    holder_name: string | null;
    pdf_url: string;
    voided: boolean;
  }[];
};
