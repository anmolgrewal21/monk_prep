import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// #6 Bulk Operations — Bulk Void
// POST /api/invoices/bulk-void
//
// What it does:
//   Accepts an array of invoice IDs and voids each one independently.
//   Same partial-success strategy as bulk-finalize.
//
// Why bulk void?
//   Month-end cleanup: cancel a batch of invoices that were sent in error,
//   or void all open invoices for a customer who terminated their contract.
//
// Rules (same as single void):
//   - Can void open or uncollectible invoices
//   - Cannot void paid invoices (use credit notes)
//   - Cannot void already-voided invoices (idempotency — skip, not error)
//   - Cannot void drafts (delete them instead)
//
// Request:  { "invoice_ids": ["inv_001", "inv_002"], "reason": "Contract cancelled" }
// Response: {
//   "results": [
//     { "id": "inv_001", "success": false, "error": "Cannot void a paid invoice" },
//     { "id": "inv_002", "success": true, "invoice": { ...voided } }
//   ],
//   "summary": { "succeeded": 1, "failed": 1, "total": 2 }
// }

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { invoice_ids, reason } = body;

  // --- Validate the request shape ---
  if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
    return NextResponse.json(
      { error: "invoice_ids must be a non-empty array" },
      { status: 400 }
    );
  }

  if (invoice_ids.length > 100) {
    return NextResponse.json(
      { error: "Batch too large. Maximum 100 invoices per request." },
      { status: 400 }
    );
  }

  const db = readDb();
  const now = new Date().toISOString();

  const results: Array<
    | { id: string; success: true; invoice: (typeof db.invoices)[number] }
    | { id: string; success: false; error: string }
  > = [];

  for (const id of invoice_ids) {
    const idx = db.invoices.findIndex((inv) => inv.id === id);

    if (idx === -1) {
      results.push({ id, success: false, error: "Invoice not found" });
      continue;
    }

    const invoice = db.invoices[idx];

    // #6 Edge case: already voided — treat as idempotent success, not error.
    // If user selected 10 invoices and one was already voided by someone else,
    // that's fine — the end state is what they wanted.
    if (invoice.status === "void") {
      results.push({
        id,
        success: false,
        error: "Invoice is already voided",
      });
      continue;
    }

    // Cannot void paid invoices — need credit notes first
    if (invoice.status === "paid") {
      results.push({
        id,
        success: false,
        error: "Cannot void a paid invoice — issue a credit note instead",
      });
      continue;
    }

    // Cannot void drafts — delete them instead
    if (invoice.status === "draft") {
      results.push({
        id,
        success: false,
        error: "Cannot void a draft invoice — delete it instead",
      });
      continue;
    }

    // --- Void this invoice (same logic as POST /api/invoices/:id/void) ---
    invoice.status = "void";
    invoice.voided_at = now;
    invoice.amount_due = 0;
    invoice.updated_at = now;
    if (reason) {
      invoice.memo = `Bulk voided: ${reason}`;
    }
    db.invoices[idx] = invoice;

    results.push({ id, success: true, invoice });
  }

  // One atomic write for the whole batch
  writeDb(db);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    results,
    summary: { succeeded, failed, total: results.length },
  });
}
