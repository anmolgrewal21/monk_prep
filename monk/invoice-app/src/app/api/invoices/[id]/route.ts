import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// GET /api/invoices/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = readDb();
  const invoice = db.invoices.find((inv) => inv.id === id);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json(invoice);
}

// PATCH /api/invoices/:id - update a draft invoice
export async function PATCH(
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
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft invoices can be edited" },
      { status: 400 }
    );
  }

  // Optimistic locking: client must send the version they read.
  // If another user updated the invoice in between, versions won't match → 409 Conflict.
  if (body.version !== undefined && body.version !== invoice.version) {
    return NextResponse.json(
      { error: "Invoice was modified by someone else. Refresh and try again." },
      { status: 409 }
    );
  }

  // Update allowed fields
  if (body.line_items) invoice.line_items = body.line_items;
  if (body.memo !== undefined) invoice.memo = body.memo;
  if (body.tax_rate !== undefined) invoice.tax_rate = body.tax_rate;
  if (body.customer_id) invoice.customer_id = body.customer_id;
  if (body.customer_name) invoice.customer_name = body.customer_name;
  if (body.customer_email) invoice.customer_email = body.customer_email;

  // Recalculate totals
  invoice.subtotal = invoice.line_items.reduce((sum, li) => sum + li.amount, 0);
  invoice.tax_amount = Math.round(invoice.subtotal * invoice.tax_rate);
  invoice.total = invoice.subtotal + invoice.tax_amount;
  invoice.amount_due = invoice.total;
  invoice.version += 1; // bump version on every write
  invoice.updated_at = new Date().toISOString();

  db.invoices[idx] = invoice;
  writeDb(db);

  return NextResponse.json(invoice);
}

// DELETE /api/invoices/:id - delete a draft invoice
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = readDb();

  const idx = db.invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (db.invoices[idx].status !== "draft") {
    return NextResponse.json(
      { error: "Only draft invoices can be deleted" },
      { status: 400 }
    );
  }

  db.invoices.splice(idx, 1);
  writeDb(db);

  return NextResponse.json({ success: true });
}
