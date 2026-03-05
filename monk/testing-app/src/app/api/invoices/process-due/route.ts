import { NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";

// POST /api/invoices/process-due — the "cron" that runs every 60 seconds in production
// Finds billing events where status = "ready" AND scheduled_date <= now
// For each due event: creates an invoice (status = "draft") and marks the event as "invoiced"
//
// From the system design:
// - Processes up to 500 billing events per run, 20 in parallel (we do sequential here — single-threaded JSON DB)
// - Invoice creation + billing event update happen in one atomic write — no partial states
// - Idempotent: if event is already "invoiced", it's skipped — safe to run multiple times
export async function POST() {
  const db = readDb();
  const now = new Date();

  // --- Find all billing events that are due right now ---
  // "ready" = waiting to be invoiced, scheduled_date <= now = due date has arrived
  const dueEvents = db.billing_events.filter(
    (be) => be.status === "ready" && new Date(be.scheduled_date) <= now
  );

  // Nothing due — the cron equivalent of "no work to do, sleep until next tick"
  if (dueEvents.length === 0) {
    return NextResponse.json({
      message: "No billing events due",
      invoices_created: 0,
    });
  }

  // --- Generate the next invoice number ---
  // In production this would be a DB sequence; here we count existing invoices
  const existingCount = db.invoices.length;
  let invoiceCounter = existingCount;

  const createdInvoices = [];

  for (const event of dueEvents) {
    invoiceCounter++;
    const invoiceNumber = `INV-${String(invoiceCounter).padStart(3, "0")}`;
    const invoiceId = generateId("inv");

    // --- Create invoice from billing event ---
    // Status starts as "draft" — not yet sent to customer
    // Will transition to "open" when the send endpoint emails the customer
    const invoice = {
      id: invoiceId,
      invoice_number: invoiceNumber,
      status: "draft" as const,
      customer_id: event.customer_id,
      date: new Date().toISOString(),
      line_item: [
        {
          id: generateId("li"),
          desc: event.description,
          amount: event.amount,
          line_total: event.amount,
        },
      ],
      total: event.amount,
      // Balance due = full amount (no payments yet)
      balance_due: event.amount,
    };

    db.invoices.push(invoice);

    // --- Mark billing event as "invoiced" — prevents double-invoicing ---
    // If the cron runs again before the next scheduled_date, this event is skipped
    event.status = "invoiced";
    event.invoice_id = invoiceId;

    createdInvoices.push(invoice);
  }

  // --- Atomic write: all invoices + all billing event updates saved together ---
  writeDb(db);

  return NextResponse.json(
    {
      message: `Processed ${createdInvoices.length} due billing event(s)`,
      invoices_created: createdInvoices.length,
      invoices: createdInvoices,
    },
    { status: 201 }
  );
}
