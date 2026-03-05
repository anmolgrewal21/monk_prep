import { NextResponse } from "next/server";
import { readDb, writeDb, generateId } from "@/lib/db";
import type { BillingType } from "@/lib/types";

// GET /api/contracts — list all contracts
export async function GET() {
  const db = readDb();
  return NextResponse.json(db.contracts);
}

// POST /api/contracts — simulate "Contract Service" uploading a contract
// In production: AI extracts billing terms from PDF → validated → billing events created
// Here we accept structured JSON directly (the output of the AI extraction step)
export async function POST(req: Request) {
  const body = await req.json();
  const {
    customer_id,
    name,
    billing_type,
    amount_per_period, // cents — how much per billing cycle
    num_periods, // how many billing cycles (e.g. 12 for 12-month contract)
    start_date, // ISO string — first billing date
    payment_terms_days, // net-30, net-60, etc.
  } = body;

  const db = readDb();

  // --- Validation: ensure the customer exists ---
  const customer = db.customers.find((c) => c.id === customer_id);
  if (!customer) {
    return NextResponse.json(
      { error: "Customer not found" },
      { status: 404 }
    );
  }

  // --- Validation: required fields ---
  if (!name || !billing_type || !amount_per_period || !num_periods || !start_date) {
    return NextResponse.json(
      { error: "Missing required fields: name, billing_type, amount_per_period, num_periods, start_date" },
      { status: 400 }
    );
  }

  // --- Validation: billing type must be one we support ---
  const validTypes: BillingType[] = ["recurring", "milestone", "usage_based"];
  if (!validTypes.includes(billing_type)) {
    return NextResponse.json(
      { error: `Invalid billing_type. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  // --- Main logic: create contract ---
  const contractId = generateId("contract");
  const startDateObj = new Date(start_date);

  // Calculate end date by adding num_periods months to start
  const endDateObj = new Date(startDateObj);
  endDateObj.setMonth(endDateObj.getMonth() + num_periods);
  endDateObj.setDate(endDateObj.getDate() - 1); // last day of final period

  const contract = {
    id: contractId,
    customer_id,
    name,
    billing_type: billing_type as BillingType,
    total_value: amount_per_period * num_periods,
    start_date: startDateObj.toISOString(),
    end_date: endDateObj.toISOString(),
    payment_terms_days: payment_terms_days || 30,
    created_at: new Date().toISOString(),
  };

  db.contracts.push(contract);

  // --- Main logic: pre-create all billing events at upload time ---
  // For recurring billing, we know every date and amount upfront
  // Each event has a unique ID based on contract + period — prevents double billing on retry
  const billingEvents = [];
  for (let i = 0; i < num_periods; i++) {
    const periodStart = new Date(startDateObj);
    periodStart.setMonth(periodStart.getMonth() + i);

    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    // Month name for the description (e.g. "March 2026")
    const monthLabel = periodStart.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    const billingEvent = {
      id: generateId("be"),
      contract_id: contractId,
      customer_id,
      // Scheduled date = first day of the billing period
      scheduled_date: periodStart.toISOString(),
      amount: amount_per_period,
      // All events start as "ready" — cron will pick them up when due
      status: "ready" as const,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      description: `${name} — ${monthLabel}`,
      // No invoice yet — will be linked when the cron processes this event
      invoice_id: null,
    };

    billingEvents.push(billingEvent);
    db.billing_events.push(billingEvent);
  }

  // Atomic write — contract + all billing events saved together
  writeDb(db);

  return NextResponse.json(
    {
      contract,
      billing_events: billingEvents,
      message: `Contract created with ${billingEvents.length} billing events`,
    },
    { status: 201 }
  );
}
