import { NextResponse } from "next/server";
import { readDb } from "@/lib/db";

// GET /api/invoices - list all invoices
export async function GET() {
  const db = readDb();
  return NextResponse.json(db.invoices);
}
