import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// #6 Bulk Operations — Bulk Finalize
// POST /api/invoices/bulk-finalize
//
// What it does:
//   Accepts an array of invoice IDs and finalizes each one independently.
//   Uses "partial success" strategy — one failing invoice doesn't block the rest.
//
// Why partial success instead of all-or-nothing?
//   Each invoice is independent. If INV-0003 has no line items, that shouldn't
//   prevent INV-0004 and INV-0005 from being finalized. The response tells the
//   client exactly which succeeded and which failed (and why), so the UI can
//   show a clear summary.
//
// Request:  { "invoice_ids": ["inv_003", "inv_006", "inv_999"] }
// Response: {
//   "results": [
//     { "id": "inv_003", "success": true, "invoice": { ...finalized invoice } },
//     { "id": "inv_006", "success": true, "invoice": { ...finalized invoice } },
//     { "id": "inv_999", "success": false, "error": "Invoice not found" }
//   ],
//   "summary": { "succeeded": 2, "failed": 1, "total": 3 }
// }

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { invoice_ids } = body;

  // --- Validate the request shape ---
  if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
    return NextResponse.json(
      { error: "invoice_ids must be a non-empty array" },
      { status: 400 }
    );
  }

  // #6 Edge case: extremely large batch — cap at a reasonable limit.
  // In production you'd queue anything over ~100, but for this app we just cap it.
  if (invoice_ids.length > 100) {
    return NextResponse.json(
      { error: "Batch too large. Maximum 100 invoices per request." },
      { status: 400 }
    );
  }

  const db = readDb();
  const now = new Date().toISOString();
  // Default due date: Net 30 (30 days from now)
  const defaultDueDate = new Date(Date.now() + 30 * 86400000).toISOString();

  // --- Process each invoice independently ---
  // This is the core of partial-success: we loop through each ID,
  // validate it, and either finalize it or record the error.
  const results: Array<
    | { id: string; success: true; invoice: (typeof db.invoices)[number] }
    | { id: string; success: false; error: string }
  > = [];

  for (const id of invoice_ids) {
    // Find the invoice
    const idx = db.invoices.findIndex((inv) => inv.id === id);

    // #6 Edge case: invoice was deleted by another user between selection and submission
    if (idx === -1) {
      results.push({ id, success: false, error: "Invoice not found" });
      continue;
    }

    const invoice = db.invoices[idx];

    // #6 Edge case: mixed statuses — some drafts, some already open
    // We skip non-drafts with a clear message instead of failing the whole batch
    if (invoice.status !== "draft") {
      results.push({
        id,
        success: false,
        error: `Cannot finalize: invoice is "${invoice.status}", not "draft"`,
      });
      continue;
    }

    // #6 Edge case: draft with no line items — can't finalize an empty invoice
    if (invoice.line_items.length === 0) {
      results.push({
        id,
        success: false,
        error: "Cannot finalize: invoice has no line items",
      });
      continue;
    }

    // --- Finalize this invoice (same logic as POST /api/invoices/:id/finalize) ---
    invoice.status = "open";
    invoice.finalized_at = now;
    invoice.due_date = defaultDueDate;
    invoice.updated_at = now;
    db.invoices[idx] = invoice;

    results.push({ id, success: true, invoice });
  }

  // --- Save all changes atomically ---
  // One writeDb call for the whole batch, not one per invoice.
  // This is important: if we wrote after each invoice, a crash mid-batch
  // would leave some finalized and some not, with no way to know which.
  writeDb(db);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    results,
    summary: { succeeded, failed, total: results.length },
  });
}
