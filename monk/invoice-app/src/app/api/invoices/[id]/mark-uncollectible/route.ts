import { NextRequest, NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// POST /api/invoices/:id/mark-uncollectible - transition open → uncollectible
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
  if (invoice.status !== "open") {
    return NextResponse.json(
      { error: "Only open invoices can be marked uncollectible" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  invoice.status = "uncollectible";
  invoice.marked_uncollectible_at = now;
  invoice.updated_at = now;

  db.invoices[idx] = invoice;
  writeDb(db);

  return NextResponse.json(invoice);
}
