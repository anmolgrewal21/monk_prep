"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Invoice, Customer, Payment } from "@/lib/types";

// Format cents → dollar string: 10050 → "$100.50"
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function InvoicePaymentPage() {
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Payment form state
  const [payAmount, setPayAmount] = useState("");
  const [payError, setPayError] = useState("");
  const [paySuccess, setPaySuccess] = useState("");
  const [paying, setPaying] = useState(false);

  async function fetchInvoice() {
    setLoading(true);
    const res = await fetch(`/api/invoices/${invoiceNumber}`);
    if (!res.ok) {
      setError("Invoice not found");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setInvoice(data.invoice);
    setCustomer(data.customer);
    setPayments(data.payments);
    setLoading(false);
  }

  useEffect(() => {
    fetchInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNumber]);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setPayError("");
    setPaySuccess("");

    // Convert dollar input to cents — API works in cents to avoid floating point issues
    const dollars = parseFloat(payAmount);

    // Client-side validation: catch obvious bad input before hitting the server
    if (isNaN(dollars) || dollars <= 0) {
      setPayError("Payment amount must be greater than $0.00");
      return;
    }

    const cents = Math.round(dollars * 100);

    // Client-side overpayment check — server also validates, but UX is faster here
    if (invoice && cents > invoice.balance_due) {
      setPayError(
        `Payment of ${formatCurrency(cents)} exceeds balance due of ${formatCurrency(invoice.balance_due)}`
      );
      return;
    }

    setPaying(true);
    const res = await fetch(`/api/invoices/${invoiceNumber}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: cents }),
    });

    const data = await res.json();

    if (!res.ok) {
      // Show server-side error (e.g. concurrent payment made balance lower)
      setPayError(data.error);
      setPaying(false);
      return;
    }

    setPaySuccess(
      `Payment of ${formatCurrency(cents)} recorded successfully!`
    );
    setPayAmount("");
    setPaying(false);

    // Refetch to show updated balance and new payment in history
    fetchInvoice();
  }

  if (loading) return <div style={{ padding: 32 }}>Loading...</div>;
  if (error)
    return <div style={{ padding: 32, color: "red" }}>{error}</div>;
  if (!invoice) return null;

  const isPaid = invoice.status === "paid";
  const isPayable = invoice.status === "open" && invoice.balance_due > 0;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 32 }}>
      {/* --- Invoice header with status badge --- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Invoice {invoice.invoice_number}</h1>
        <span
          style={{
            padding: "4px 12px",
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            background: isPaid
              ? "#d4edda"
              : invoice.status === "open"
                ? "#cce5ff"
                : "#f8d7da",
            color: isPaid
              ? "#155724"
              : invoice.status === "open"
                ? "#004085"
                : "#721c24",
          }}
        >
          {invoice.status.toUpperCase()}
        </span>
      </div>

      {/* --- Invoice meta: date + customer --- */}
      <div style={{ marginBottom: 24, color: "#555" }}>
        <p>Date: {new Date(invoice.date).toLocaleDateString()}</p>
        {customer && (
          <p>
            Bill to: {customer.name} ({customer.email})
          </p>
        )}
      </div>

      {/* --- Line items table --- */}
      <table
        style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
            <th style={{ padding: 8 }}>Description</th>
            <th style={{ padding: 8, textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.line_item.map((li) => (
            <tr key={li.id} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: 8 }}>{li.desc}</td>
              <td style={{ padding: 8, textAlign: "right" }}>
                {formatCurrency(li.line_total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid #333" }}>
            <td style={{ padding: 8, fontWeight: 700 }}>Total</td>
            <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>
              {formatCurrency(invoice.total)}
            </td>
          </tr>
          <tr>
            <td style={{ padding: 8, fontWeight: 700 }}>Balance Due</td>
            <td
              style={{
                padding: 8,
                textAlign: "right",
                fontWeight: 700,
                color: invoice.balance_due > 0 ? "#c00" : "#080",
              }}
            >
              {formatCurrency(invoice.balance_due)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* --- Payment form: only if invoice is open with remaining balance --- */}
      {isPayable && (
        <div
          style={{
            background: "#f9f9f9",
            padding: 20,
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <h3 style={{ marginBottom: 12 }}>Make a Payment</h3>
          <form
            onSubmit={handlePay}
            style={{ display: "flex", gap: 12, alignItems: "center" }}
          >
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#555",
                }}
              >
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                style={{
                  padding: "8px 8px 8px 24px",
                  fontSize: 16,
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  width: 160,
                }}
              />
            </div>
            <button
              type="submit"
              disabled={paying}
              style={{
                padding: "8px 20px",
                fontSize: 16,
                background: "#0070f3",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: paying ? "not-allowed" : "pointer",
                opacity: paying ? 0.6 : 1,
              }}
            >
              {paying ? "Processing..." : "Pay"}
            </button>
          </form>
          {payError && (
            <p style={{ color: "red", marginTop: 8 }}>{payError}</p>
          )}
          {paySuccess && (
            <p style={{ color: "green", marginTop: 8 }}>{paySuccess}</p>
          )}
        </div>
      )}

      {/* --- Fully paid message --- */}
      {isPaid && (
        <div
          style={{
            background: "#d4edda",
            padding: 16,
            borderRadius: 8,
            marginBottom: 24,
            color: "#155724",
          }}
        >
          This invoice has been paid in full. Thank you!
        </div>
      )}

      {/* --- Payment history: shows all previous payments --- */}
      {payments.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>Payment History</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{ borderBottom: "2px solid #333", textAlign: "left" }}
              >
                <th style={{ padding: 8 }}>Date</th>
                <th style={{ padding: 8, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  style={{ borderBottom: "1px solid #ddd" }}
                >
                  <td style={{ padding: 8 }}>
                    {new Date(p.date).toLocaleString()}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>
                    {formatCurrency(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
