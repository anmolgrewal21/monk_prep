import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";
import { Payment } from "@/lib/types";

// POST /api/invoices/:id/payments - record a payment (track payment)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const db = readDb();

  const idx = db.invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const invoice = db.invoices[idx];
  if (invoice.status !== "open") {
    return NextResponse.json(
      { error: "Can only record payments on open invoices" },
      { status: 400 }
    );
  }

  // Idempotency: if client sends a key we've already processed, return the original payment.
  // Prevents double-charging on retry, double-click, or network hiccup.
  const idempotencyKey = body.idempotency_key;
  if (idempotencyKey) {
    const existing = db.payments.find((p) => p.idempotency_key === idempotencyKey);
    if (existing) {
      return NextResponse.json({ payment: existing, invoice }, { status: 200 });
    }
  }

  const amount = body.amount;
  if (!amount || amount <= 0 || amount > invoice.amount_due) {
    return NextResponse.json(
      { error: `Payment must be between 1 and ${invoice.amount_due}` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const payment: Payment = {
    id: generateId("pay"),
    invoice_id: id,
    idempotency_key: idempotencyKey || generateId("idk"), // server generates if client doesn't send one
    amount,
    method: body.method || "credit_card",
    paid_at: now,
    note: body.note,
  };

  db.payments.push(payment);

  invoice.amount_due -= amount;
  invoice.updated_at = now;

  if (invoice.amount_due === 0) {
    invoice.status = "paid";
    invoice.paid_at = now;
  }

  db.invoices[idx] = invoice;
  writeDb(db);

  return NextResponse.json({ payment, invoice }, { status: 201 });
}

// GET /api/invoices/:id/payments - list payments for an invoice
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = readDb();
  const payments = db.payments.filter((p) => p.invoice_id === id);
  return NextResponse.json(payments);
}
