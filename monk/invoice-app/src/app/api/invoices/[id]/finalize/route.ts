import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// POST /api/invoices/:id/finalize - transition draft → open
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = readDb();

  const idx = db.invoices.findIndex((inv) => inv.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const invoice = db.invoices[idx];
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft invoices can be finalized" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  invoice.status = "open";
  invoice.finalized_at = now;
  invoice.due_date =
    body.due_date || new Date(Date.now() + 30 * 86400000).toISOString(); // default Net 30
  invoice.updated_at = now;

  db.invoices[idx] = invoice;
  writeDb(db);

  return NextResponse.json(invoice);
}
