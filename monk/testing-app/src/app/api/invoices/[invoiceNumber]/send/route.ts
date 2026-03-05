import { NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/db";

// POST /api/invoices/[invoiceNumber]/send — send an invoice to the customer
// Transitions status: draft → open
// In production:
//   1. Generates PDF of the invoice
//   2. Creates a JWT payment token (signed with invoice_id + company_id, expires 30 days)
//   3. Embeds token in a payment URL: yourapp.com/invoices/INV-001?token=<jwt>
//   4. Emails the PDF + payment link to the customer
//   5. Uploads to procurement portal if required (Coupa, Ariba, SAP)
//   6. Posts "invoice.sent" to message queue — Collections Agent starts watching for overdue
// Here: we stub all of this and just transition the status + return the payment link
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ invoiceNumber: string }> }
) {
  const { invoiceNumber } = await params;
  const db = readDb();

  const invoice = db.invoices.find(
    (inv) => inv.invoice_number === invoiceNumber
  );

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // --- Edge case: can only send "draft" invoices ---
  if (invoice.status !== "draft") {
    return NextResponse.json(
      {
        error: `Cannot send an invoice with status "${invoice.status}". Only draft invoices can be sent.`,
      },
      { status: 400 }
    );
  }

  // --- Main logic: transition draft → open ---
  invoice.status = "open";

  // --- Stub: generate a payment token ---
  // In production this would be a real JWT signed with a secret key
  const stubToken = Buffer.from(
    JSON.stringify({
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      exp: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
  ).toString("base64url");

  const paymentLink = `/invoices/${invoice.invoice_number}?token=${stubToken}`;

  const customer = db.customers.find((c) => c.id === invoice.customer_id);

  writeDb(db);

  return NextResponse.json({
    message: `Invoice ${invoice.invoice_number} sent to ${customer?.email ?? "customer"}`,
    invoice,
    payment_link: paymentLink,
    email_stub: {
      to: customer?.email,
      subject: `Invoice ${invoice.invoice_number} — ${(invoice.total / 100).toFixed(2)} due`,
      body: `Please pay your invoice using this link: ${paymentLink}`,
      pdf_attached: true,
    },
  });
}
