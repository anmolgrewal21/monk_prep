import { NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";

// POST /api/invoices/[invoiceNumber]/pay — record a payment against an invoice
// Stubbed payment processing: no real gateway, just validates and records
export async function POST(
  req: Request,
  { params }: { params: Promise<{ invoiceNumber: string }> }
) {
  const { invoiceNumber } = await params;
  const body = await req.json();
  const { amount } = body; // amount in cents

  const db = readDb();
  const invoice = db.invoices.find(
    (inv) => inv.invoice_number === invoiceNumber
  );

  // Edge case: invoice doesn't exist
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Edge case: can only pay "open" invoices
  // Draft = not sent yet, void = cancelled, paid = already done, uncollectible = written off
  if (invoice.status !== "open") {
    return NextResponse.json(
      { error: `Cannot pay an invoice with status "${invoice.status}"` },
      { status: 400 }
    );
  }

  // Edge case: reject non-numeric or zero/negative payments
  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json(
      { error: "Payment amount must be greater than $0" },
      { status: 400 }
    );
  }

  // Edge case: reject payments that exceed remaining balance — prevents negative balance_due
  if (amount > invoice.balance_due) {
    return NextResponse.json(
      {
        error: `Payment of $${(amount / 100).toFixed(2)} exceeds balance due of $${(invoice.balance_due / 100).toFixed(2)}`,
      },
      { status: 400 }
    );
  }

  // --- Main logic: record payment and update invoice ---

  const payment = {
    id: generateId("pay"),
    invoice_id: invoice.id,
    amount,
    date: new Date().toISOString(),
  };
  db.payments.push(payment);

  // Reduce balance by payment amount (partial payment support)
  invoice.balance_due -= amount;

  // Auto-transition: if balance hits zero, mark invoice as "paid"
  // This is the only automatic status change — all others require explicit action
  if (invoice.balance_due === 0) {
    invoice.status = "paid";
  }

  // Single atomic write — payment + invoice update saved together
  // If this crashes mid-write, neither change persists (no partial state)
  writeDb(db);

  return NextResponse.json({ payment, invoice }, { status: 201 });
}
