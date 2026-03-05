"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [invoices, setInvoices] = useState<any[]>([]);

  async function fetchInvoices() {
    const res = await fetch("/api/invoices");
    const data = await res.json();
    setInvoices(data);
  }

  useEffect(() => {
    fetchInvoices();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 32 }}>
      <h1>Invoice App</h1>
      <p>{invoices.length} invoices</p>
    </div>
  );
}
