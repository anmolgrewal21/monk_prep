import { NextResponse } from "next/server";
import { readDb } from "@/lib/db";

// GET /api/invoices/[invoiceNumber] — fetch a single invoice by its human-readable number
// Returns a joined view: { invoice, customer, payments }
// Why join here: the payment page needs all three in one request to render
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ invoiceNumber: string }> }
) {
  const { invoiceNumber } = await params;
  const db = readDb();

  // Look up by invoice_number (the human-readable ID in the URL), not internal id
  const invoice = db.invoices.find(
    (inv) => inv.invoice_number === invoiceNumber
  );

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Join customer data so the page can show "Bill to: ..."
  const customer = db.customers.find((c) => c.id === invoice.customer_id);

  // Collect all payments for this invoice — for the payment history section
  const payments = db.payments.filter((p) => p.invoice_id === invoice.id);

  return NextResponse.json({ invoice, customer, payments });
}
