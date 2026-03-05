import { NextResponse } from "next/server";
import { readDb } from "@/lib/db";

// GET /api/customers
export async function GET() {
  const db = readDb();
  return NextResponse.json(db.customers);
}
