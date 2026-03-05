export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";
export type PaymentMethod = "credit_card" | "bank_transfer" | "check" | "cash";

// --- Payment ---
// Append-only ledger. One invoice can have many payments (partial payments).
export interface Payment {
  id: string;              // PK
  invoice_id: string;      // FK → invoices(id), INDEX
  idempotency_key: string; // UNIQUE — prevents double-charging on retry/double-click
  amount: number;          // cents
  method: PaymentMethod;
  paid_at: string;
  note?: string;
}
// INDEX invoice_id: every payment lookup, credit note validation (#4), revise pre-check (#5)
// UNIQUE idempotency_key: server deduplicates — if key exists, return original response

// --- Line Item ---
// Embedded in invoice (JSON) or separate table (SQL) with FK → invoices(id).
export interface LineItem {
  id: string;        // PK
  description: string;
  quantity: number;
  unit_price: number; // cents
  amount: number;     // quantity * unit_price, cents — computed server-side
}

// --- Invoice ---
// Core entity. Immutable after finalization (status != draft).
export interface Invoice {
  id: string;                          // PK
  invoice_number: string;              // UNIQUE — human-readable, e.g. INV-0001
  status: InvoiceStatus;               // INDEX — filtered in every list query, bulk ops ()
  customer_id: string;                 // FK → customers(id), INDEX
  customer_name: string;
  customer_email: string;
  line_items: LineItem[];
  subtotal: number;                    // cents
  tax_rate: number;                    // e.g. 0.08 for 8%
  tax_amount: number;                  // cents
  total: number;                       // cents
  amount_due: number;                  // cents — total minus payments
  version: number;                     // optimistic locking — incremented on every update, 409 on mismatch
  finalized_at: string | null;
  due_date: string | null;             // INDEX (composite with status) — overdue = open + past due
  paid_at: string | null;
  voided_at: string | null;
  marked_uncollectible_at: string | null;
  memo?: string;
  revised_from: string | null;         // FK → invoices(id), INDEX — #5 void+revise audit chain
  created_at: string;
  updated_at: string;
}
// INDEX status: bulk finalize drafts (#6), bulk void open (#6), every route checks status
// INDEX customer_id: "all invoices for customer X"
// INDEX (status, due_date): "all overdue invoices" = open + due_date < now
// INDEX revised_from: "find revision of invoice X" — UI shows chain (#5)
// UNIQUE invoice_number: prevent collision on concurrent creates
// version: on PATCH, client sends version. Server checks current === sent, then increments.
// Mismatch → 409 Conflict "Invoice was modified by someone else. Refresh and try again."


// --- Credit Note Item ---
// Line-item level refund detail. Tracks exactly which line items were refunded and how many.
// "2 of 5 Training Sessions refunded at $500 each" — not just "$1000 back".
export interface CreditNoteItem {
  id: string;            // PK
  line_item_id: string;  // FK → line_items(id), INDEX
  description: string;   // copied from original for readability
  quantity: number;       // units refunded
  unit_price: number;    // cents, copied from original
  amount: number;        // quantity * unit_price, cents — computed server-side
}
// INDEX line_item_id: "how many units of this item already refunded?" (#4)

// --- Credit Note ---
// Immutable once created. Separate entity (not a negative invoice).
// Used for: disputes, overpayments, refunding before void+revise (#5).
export interface CreditNote {
  id: string;                // PK
  credit_note_number: string; // UNIQUE — CN-0001 (separate sequence from invoices)
  invoice_id: string;        // FK → invoices(id), INDEX
  items: CreditNoteItem[];   // line-item breakdown
  total: number;             // cents — sum of item amounts
  reason: string;
  created_at: string;        // immutable, no updated_at
}
// INDEX invoice_id: refund balance check (#4), revise pre-check (#5), listing

// --- Customer ---
export interface Customer {
  id: string;        // PK
  name: string;
  email: string;     // UNIQUE — one account per email
  address?: string;
  created_at: string;
}
// UNIQUE email: prevents duplicate customer accounts, used for login/lookup

// --- Database ---
export interface Database {
  invoices: Invoice[];
  customers: Customer[];
  payments: Payment[];
  credit_notes: CreditNote[];
}
