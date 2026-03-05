// Define your schema here during the interview
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export interface LineItem {
  id: string;
  desc: string;
  amount: number;
  line_total: number;
}

export interface Mapping {
  link_id: string; // string pointing to the link
  invoice_id: string;
}

export interface Invoice {
  id: string; // for internal use // UUID
  invoice_number: string; // visible to user // INV_0001
  // Changed: string → InvoiceStatus — enforce only valid statuses, prevents typos like "opn"
  status: InvoiceStatus;
  customer_id: string;
  date: string; // use UTC universal type
  line_item: LineItem[];
  total: number; // cents
  balance_due: number;
}

export interface Customer {
  id: string;
  // Added: invoice page needs to display who the invoice is billed to
  name: string;
  email: string;
}

export interface Payment {
  id: string; // PK
  invoice_id: string; // FK // index if not keeping track of balance
  amount: number;
  // Added: record when payment was made — needed for payment history display
  date: string;
}

// --- Billing types (Invoice Service — from system design) ---

// Three billing models Monk supports: recurring (fixed schedule), milestone (event-triggered), usage-based (metered)
export type BillingType = "recurring" | "milestone" | "usage_based";

// Billing event lifecycle: ready → invoiced (happy path), or ready → cancelled (contract amended)
export type BillingEventStatus = "ready" | "invoiced" | "cancelled";

// Contract represents an uploaded agreement — the source of all billing events
export interface Contract {
  id: string;
  customer_id: string;
  // Human-readable label for the contract, e.g. "ElevenLabs Enterprise 6-mo"
  name: string;
  billing_type: BillingType;
  // Total value of the contract in cents — sum of all billing events
  total_value: number;
  start_date: string;
  end_date: string;
  // Net payment terms in days (e.g. 30 = net-30)
  payment_terms_days: number;
  created_at: string;
}

// BillingEvent is one scheduled invoice in a contract's billing schedule
// A 12-month contract creates 12 billing events — one per period
export interface BillingEvent {
  id: string;
  contract_id: string;
  customer_id: string;
  // When this billing event becomes due — cron checks scheduled_date <= now
  scheduled_date: string;
  amount: number; // cents
  status: BillingEventStatus;
  // Period this billing event covers (e.g. March 1 – March 31)
  period_start: string;
  period_end: string;
  // Line item description that will appear on the generated invoice
  description: string;
  // Links to the invoice created from this event — null until invoiced
  invoice_id: string | null;
}

// --- Database ---
export interface Database {
  invoices: Invoice[];
  // Changed: unknown[] → Customer[] / Payment[] — type safety so TS catches mistakes at compile time
  customers: Customer[];
  payments: Payment[];
  // Contract Service + Invoice Service scheduling layer
  contracts: Contract[];
  billing_events: BillingEvent[];
}
