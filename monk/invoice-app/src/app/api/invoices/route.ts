import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";
import { Invoice, LineItem } from "@/lib/types";

// GET /api/invoices - list all invoices
export async function GET() {
  const db = readDb();
  return NextResponse.json(db.invoices);
}

// POST /api/invoices - create a new draft invoice
export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = readDb();

  const invoiceCount = db.invoices.length + 1;
  const now = new Date().toISOString();

  const lineItems: LineItem[] = (body.line_items || []).map(
    (li: Partial<LineItem>) => ({
      id: generateId("li"),
      description: li.description || "",
      quantity: li.quantity || 0,
      unit_price: li.unit_price || 0,
      amount: (li.quantity || 0) * (li.unit_price || 0),
    })
  );

  const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
  const taxRate = body.tax_rate ?? 0;
  const taxAmount = Math.round(subtotal * taxRate);
  const total = subtotal + taxAmount;

  const invoice: Invoice = {
    id: generateId("inv"),
    invoice_number: `INV-${String(invoiceCount).padStart(4, "0")}`,
    status: "draft",
    customer_id: body.customer_id,
    customer_name: body.customer_name || "",
    customer_email: body.customer_email || "",
    line_items: lineItems,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
    amount_due: total,
    version: 1, // optimistic locking — starts at 1, incremented on every update
    finalized_at: null,
    due_date: null,
    paid_at: null,
    voided_at: null,
    marked_uncollectible_at: null,
    // #5 Void + Revise: track if this invoice was created as a revision of a voided one
    revised_from: body.revised_from || null,
    memo: body.memo,
    created_at: now,
    updated_at: now,
  };

  db.invoices.push(invoice);
  writeDb(db);

  return NextResponse.json(invoice, { status: 201 });
}
