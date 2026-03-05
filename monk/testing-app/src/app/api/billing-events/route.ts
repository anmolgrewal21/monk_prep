import { NextResponse } from "next/server";
import { readDb } from "@/lib/db";

// GET /api/billing-events — list all billing events, optionally filtered by status or contract
// Useful for the finance dashboard to see upcoming invoices and their status
export async function GET(req: Request) {
  const db = readDb();
  const { searchParams } = new URL(req.url);

  let events = db.billing_events;

  // Optional filter: ?status=ready — show only events waiting to be invoiced
  const status = searchParams.get("status");
  if (status) {
    events = events.filter((be) => be.status === status);
  }

  // Optional filter: ?contract_id=contract_001 — show events for a specific contract
  const contractId = searchParams.get("contract_id");
  if (contractId) {
    events = events.filter((be) => be.contract_id === contractId);
  }

  return NextResponse.json(events);
}
