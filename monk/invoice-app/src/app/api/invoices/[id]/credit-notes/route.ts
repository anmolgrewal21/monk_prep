import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";
import { CreditNote, CreditNoteItem } from "@/lib/types";

// #4 Credit Notes & Refunds — Line-Item Level
//
// POST /api/invoices/:id/credit-notes — Issue a credit note (refund) against an invoice
//
// Line-item level credits: instead of a flat dollar amount, the client sends
// which specific line items to refund and how many units of each.
// This gives a full audit trail: "2 of 5 Training Sessions refunded" vs just "$100 back".
//
// Request body:
//   {
//     "reason": "Only 3 of 5 training sessions delivered",
//     "items": [
//       { "line_item_id": "li_013", "quantity": 2 }
//     ]
//   }
//
// The server looks up the original line item to get unit_price and validates:
//   - line_item_id must exist on this invoice
//   - quantity must be > 0 and <= original quantity minus already-refunded quantity
//   - total credit across all credit notes can't exceed total payments
//
// Rules:
//   - Can only credit open or paid invoices (not draft, void, or uncollectible)
//   - Credit notes are immutable once created (like finalized invoices)
//   - Issuing a credit note reduces amount_due on open invoices
//   - If a paid invoice is fully credited, it stays "paid"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const db = readDb();

  // --- Find the invoice ---
  const idx = db.invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const invoice = db.invoices[idx];

  // --- Validate status ---
  // Can only issue credit notes on open or paid invoices
  // - draft: not finalized, just delete or edit it
  // - void: already cancelled, nothing to refund
  // - uncollectible: no payments to refund (void it instead)
  if (invoice.status !== "open" && invoice.status !== "paid") {
    return NextResponse.json(
      { error: "Can only issue credit notes on open or paid invoices" },
      { status: 400 }
    );
  }

  // --- Validate reason ---
  if (!body.reason || body.reason.trim() === "") {
    return NextResponse.json(
      { error: "A reason is required for credit notes" },
      { status: 400 }
    );
  }

  // --- Validate items array ---
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "Credit note must include at least one line item to refund" },
      { status: 400 }
    );
  }

  // --- Build CreditNoteItems by validating each against the invoice's line items ---
  // We also need to check how much of each line item has already been refunded
  // across all existing credit notes for this invoice.
  const existingCredits = db.credit_notes.filter((cn) => cn.invoice_id === id);

  // Build a map: line_item_id → total quantity already refunded
  const alreadyRefundedQty: Record<string, number> = {};
  for (const cn of existingCredits) {
    for (const item of cn.items) {
      alreadyRefundedQty[item.line_item_id] =
        (alreadyRefundedQty[item.line_item_id] || 0) + item.quantity;
    }
  }

  const creditItems: CreditNoteItem[] = [];

  for (const reqItem of body.items) {
    // Find the original line item on this invoice
    const originalLi = invoice.line_items.find(
      (li) => li.id === reqItem.line_item_id
    );
    if (!originalLi) {
      return NextResponse.json(
        {
          error: `Line item "${reqItem.line_item_id}" not found on this invoice`,
        },
        { status: 400 }
      );
    }

    const qty = reqItem.quantity;
    if (!qty || qty <= 0) {
      return NextResponse.json(
        {
          error: `Quantity must be > 0 for line item "${originalLi.description}"`,
        },
        { status: 400 }
      );
    }

    // Check: can't refund more units than the original minus already refunded
    const alreadyRefunded = alreadyRefundedQty[originalLi.id] || 0;
    const refundableQty = originalLi.quantity - alreadyRefunded;

    if (qty > refundableQty) {
      return NextResponse.json(
        {
          error: `Cannot refund ${qty} of "${originalLi.description}". Original: ${originalLi.quantity}, already refunded: ${alreadyRefunded}, refundable: ${refundableQty}`,
        },
        { status: 400 }
      );
    }

    creditItems.push({
      id: generateId("cni"),
      line_item_id: originalLi.id,
      description: originalLi.description, // copy for readability
      quantity: qty,
      unit_price: originalLi.unit_price, // copy from original
      amount: qty * originalLi.unit_price, // calculated server-side, never trust client
    });
  }

  // --- Calculate total credit amount ---
  const creditTotal = creditItems.reduce((sum, item) => sum + item.amount, 0);

  // --- Validate total doesn't exceed refundable payment balance ---
  // Can't refund more money than has been paid minus what's already been refunded
  const totalPaid = db.payments
    .filter((p) => p.invoice_id === id)
    .reduce((sum, p) => sum + p.amount, 0);

  const totalAlreadyCredited = existingCredits.reduce(
    (sum, cn) => sum + cn.total,
    0
  );

  const refundableAmount = totalPaid - totalAlreadyCredited;
  if (creditTotal > refundableAmount) {
    return NextResponse.json(
      {
        error: `Credit total ($${(creditTotal / 100).toFixed(2)}) exceeds refundable balance. Paid: $${(totalPaid / 100).toFixed(2)}, already credited: $${(totalAlreadyCredited / 100).toFixed(2)}, refundable: $${(refundableAmount / 100).toFixed(2)}`,
      },
      { status: 400 }
    );
  }

  // --- Create the credit note ---
  const now = new Date().toISOString();
  const cnCount = db.credit_notes.length + 1;

  const creditNote: CreditNote = {
    id: generateId("cn"),
    credit_note_number: `CN-${String(cnCount).padStart(4, "0")}`,
    invoice_id: id,
    items: creditItems,
    total: creditTotal,
    reason: body.reason,
    created_at: now,
  };

  db.credit_notes.push(creditNote);

  // --- Update the invoice's amount_due ---
  // For open invoices: recalculate based on payments minus credits
  // For paid invoices: amount_due stays 0 (credit creates customer balance)
  if (invoice.status === "open") {
    const newTotalCredited = totalAlreadyCredited + creditTotal;
    const netPaid = totalPaid - newTotalCredited;
    invoice.amount_due = invoice.total - netPaid;
  }

  invoice.updated_at = now;
  db.invoices[idx] = invoice;
  writeDb(db);

  return NextResponse.json(
    { credit_note: creditNote, invoice },
    { status: 201 }
  );
}

// GET /api/invoices/:id/credit-notes — List all credit notes for an invoice
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = readDb();
  const creditNotes = db.credit_notes.filter((cn) => cn.invoice_id === id);
  return NextResponse.json(creditNotes);
}
