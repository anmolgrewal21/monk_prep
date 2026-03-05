import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// POST /api/invoices/:id/void - void an invoice (manage status)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = readDb();

  const idx = db.invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const invoice = db.invoices[idx];
  if (invoice.status === "void") {
    return NextResponse.json(
      { error: "Invoice is already voided" },
      { status: 400 }
    );
  }
  if (invoice.status === "paid") {
    return NextResponse.json(
      { error: "Cannot void a paid invoice — issue a credit note instead" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  invoice.status = "void";
  invoice.voided_at = now;
  invoice.amount_due = 0;
  invoice.updated_at = now;

  db.invoices[idx] = invoice;
  writeDb(db);

  return NextResponse.json(invoice);
}
