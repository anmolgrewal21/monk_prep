import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";
import { Invoice, LineItem } from "@/lib/types";

// #5 Void + Revise Workflow
// POST /api/invoices/:id/revise
//
// What it does:
//   1. Validates the original invoice is "open" and has no payments
//   2. Voids the original invoice
//   3. Creates a new draft invoice pre-filled with the original's data
//   4. Links the new draft to the original via revised_from
//
// Why:
//   Finalized invoices are immutable. If something is wrong (wrong qty, wrong price),
//   you can't edit it. Instead, void the original and create a corrected copy.
//
// Returns both the voided original and the new draft so the UI can show what happened.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = readDb();

  // --- Step 1: Find and validate the original invoice ---
  const idx = db.invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const original = db.invoices[idx];

  // Can only revise open invoices
  // - draft: just edit it directly, no need to revise
  // - paid: use credit notes instead
  // - void: already cancelled
  // - uncollectible: void it first, then create new invoice manually
  if (original.status !== "open") {
    return NextResponse.json(
      { error: "Only open invoices can be revised. Void + revise replaces a finalized invoice." },
      { status: 400 }
    );
  }

  // Block revising if there are unrefunded payments.
  // If customer paid $500, you must issue $500 in credit notes first.
  // Once all payments are fully refunded (credits >= payments), revise is allowed.
  const totalPaid = db.payments
    .filter((p) => p.invoice_id === id)
    .reduce((sum, p) => sum + p.amount, 0);
  const totalCredited = db.credit_notes
    .filter((cn) => cn.invoice_id === id)
    .reduce((sum, cn) => sum + cn.total, 0);
  const unrefunded = totalPaid - totalCredited;

  if (unrefunded > 0) {
    return NextResponse.json(
      {
        error: `Cannot revise: $${(unrefunded / 100).toFixed(2)} in payments not yet refunded. Issue credit notes first.`,
      },
      { status: 400 }
    );
  }

  // Idempotency: if already voided (e.g. double-click), don't void again
  if (original.voided_at) {
    return NextResponse.json(
      { error: "Invoice has already been voided" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // --- Step 2: Void the original invoice ---
  // Same logic as POST /api/invoices/:id/void
  original.status = "void";
  original.voided_at = now;
  original.amount_due = 0;
  original.updated_at = now;
  // Append reason to memo so there's an audit trail
  original.memo = body.reason
    ? `Voided for revision: ${body.reason}`
    : "Voided for revision";

  db.invoices[idx] = original;

  // --- Step 3: Create a new draft invoice pre-filled with original's data ---
  // New ID, new invoice number — but same customer, line items, tax rate
  const invoiceCount = db.invoices.length + 1;

  // Copy line items with new IDs (they're a new invoice's items now)
  const copiedLineItems: LineItem[] = original.line_items.map((li) => ({
    id: generateId("li"),
    description: li.description,
    quantity: li.quantity,
    unit_price: li.unit_price,
    amount: li.amount,
  }));

  const newInvoice: Invoice = {
    id: generateId("inv"),
    invoice_number: `INV-${String(invoiceCount).padStart(4, "0")}`,
    status: "draft", // starts as draft so the user can edit before re-finalizing
    customer_id: original.customer_id,
    customer_name: original.customer_name,
    customer_email: original.customer_email,
    line_items: copiedLineItems,
    subtotal: original.subtotal,
    tax_rate: original.tax_rate,
    tax_amount: original.tax_amount,
    total: original.total,
    amount_due: original.total, // full amount since no payments on the new one
    version: 1, // new invoice starts at version 1
    finalized_at: null, // not finalized yet — it's a draft
    due_date: null,
    paid_at: null,
    voided_at: null,
    marked_uncollectible_at: null,
    // #5: Link back to the voided original for audit trail
    revised_from: original.id,
    memo: `Revised from ${original.invoice_number}`,
    created_at: now,
    updated_at: now,
  };

  db.invoices.push(newInvoice);

  // --- Step 4: Save both changes atomically ---
  writeDb(db);

  // Return both so the frontend knows what happened
  return NextResponse.json(
    {
      voided_invoice: original,
      new_invoice: newInvoice,
    },
    { status: 201 }
  );
}
