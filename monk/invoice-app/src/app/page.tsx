"use client";

import { useEffect, useState } from "react";
import { Invoice } from "@/lib/types";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  const styles: Record<string, { bg: string; color: string }> = {
    draft: { bg: "#f3f4f6", color: "#374151" },
    open: { bg: "#dbeafe", color: "#1d4ed8" },
    paid: { bg: "#dcfce7", color: "#15803d" },
    void: { bg: "#e5e7eb", color: "#6b7280" },
    uncollectible: { bg: "#ffedd5", color: "#c2410c" },
  };
  const s = styles[status] || { bg: "#f3f4f6", color: "#374151" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "2px 10px",
        borderRadius: "9999px",
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

export default function Home() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  // #6 Bulk Operations: track which invoices are selected via checkboxes
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function fetchInvoices() {
    const res = await fetch("/api/invoices");
    const data = await res.json();
    setInvoices(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchInvoices();
  }, []);

  async function handleFinalize(id: string) {
    await fetch(`/api/invoices/${id}/finalize`, { method: "POST" });
    fetchInvoices();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    fetchInvoices();
  }

  async function handleVoid(id: string) {
    await fetch(`/api/invoices/${id}/void`, { method: "POST" });
    fetchInvoices();
  }

  async function handleMarkUncollectible(id: string) {
    await fetch(`/api/invoices/${id}/mark-uncollectible`, { method: "POST" });
    fetchInvoices();
  }

  // #5 Void + Revise: voids the original and creates a new draft copy
  async function handleRevise(id: string) {
    await fetch(`/api/invoices/${id}/revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Needs correction" }),
    });
    fetchInvoices();
  }

  // #4 Credit Notes (line-item level): prompts the user for which line items
  // to refund and how many units of each, then sends to the credit-notes API.
  async function handleRefund(inv: Invoice) {
    const reason = prompt("Reason for refund:");
    if (!reason) return; // user cancelled

    // For each line item on the invoice, ask how many units to refund.
    // User enters 0 (or cancels) to skip a line item.
    const items: { line_item_id: string; quantity: number }[] = [];

    for (const li of inv.line_items) {
      const qtyStr = prompt(
        `Refund how many of "${li.description}"?\n` +
          `(Original qty: ${li.quantity}, unit price: $${(li.unit_price / 100).toFixed(2)})\n` +
          `Enter 0 to skip:`
      );
      if (qtyStr === null) return; // user cancelled entirely
      const qty = parseInt(qtyStr, 10);
      if (isNaN(qty) || qty <= 0) continue; // skip this line item
      items.push({ line_item_id: li.id, quantity: qty });
    }

    if (items.length === 0) {
      alert("No items selected for refund.");
      return;
    }

    const res = await fetch(`/api/invoices/${inv.id}/credit-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, items }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(`Refund failed: ${data.error}`);
      return;
    }

    alert(`Credit note ${data.credit_note.credit_note_number} created for $${(data.credit_note.total / 100).toFixed(2)}`);
    fetchInvoices();
  }

  async function handlePayFull(id: string, amountDue: number) {
    await fetch(`/api/invoices/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountDue, method: "credit_card" }),
    });
    fetchInvoices();
  }

  // #6 Bulk Operations: toggle a single invoice's selection
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // #6 Bulk Operations: select or deselect all invoices
  function toggleSelectAll() {
    if (selected.size === invoices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(invoices.map((inv) => inv.id)));
    }
  }

  // #6 Bulk Operations: finalize all selected draft invoices at once
  async function handleBulkFinalize() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const res = await fetch("/api/invoices/bulk-finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_ids: ids }),
    });
    const data = await res.json();

    // Show summary so user knows what happened (partial success)
    alert(
      `Bulk Finalize: ${data.summary.succeeded} succeeded, ${data.summary.failed} failed`
    );

    setSelected(new Set());
    fetchInvoices();
  }

  // #6 Bulk Operations: void all selected open/uncollectible invoices at once
  async function handleBulkVoid() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const res = await fetch("/api/invoices/bulk-void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_ids: ids, reason: "Bulk voided" }),
    });
    const data = await res.json();

    alert(
      `Bulk Void: ${data.summary.succeeded} succeeded, ${data.summary.failed} failed`
    );

    setSelected(new Set());
    fetchInvoices();
  }

  if (loading) {
    return <p style={{ color: "#6b7280" }}>Loading invoices...</p>;
  }

  const btnStyle = (bg: string, color: string) => ({
    fontSize: "13px",
    padding: "4px 12px",
    borderRadius: "4px",
    border: "none",
    cursor: "pointer",
    fontWeight: 500 as const,
    background: bg,
    color: color,
  });

  return (
    <div>
      <h2 style={{ fontSize: "24px", fontWeight: 600, color: "#111827", marginBottom: "24px" }}>
        Invoices
      </h2>

      {/* #6 Bulk Operations: action bar shows when invoices are selected */}
      {selected.size > 0 && (
        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            marginBottom: "16px",
            padding: "12px 24px",
            background: "#eff6ff",
            borderRadius: "8px",
            border: "1px solid #bfdbfe",
          }}
        >
          <span style={{ fontSize: "14px", color: "#1d4ed8", fontWeight: 500 }}>
            {selected.size} invoice{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button onClick={handleBulkFinalize} style={btnStyle("#2563eb", "#ffffff")}>
            Bulk Finalize
          </button>
          <button onClick={handleBulkVoid} style={btnStyle("#e5e7eb", "#374151")}>
            Bulk Void
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ ...btnStyle("#ffffff", "#6b7280"), border: "1px solid #d1d5db" }}
          >
            Clear Selection
          </button>
        </div>
      )}

      <div style={{ background: "#ffffff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden" }}>
        <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              {/* #6 Bulk Operations: select-all checkbox in header */}
              <th style={{ padding: "12px 12px 12px 24px", width: "32px" }}>
                <input
                  type="checkbox"
                  checked={selected.size === invoices.length && invoices.length > 0}
                  onChange={toggleSelectAll}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Invoice #</th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Customer</th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Status</th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500, textAlign: "right" }}>Total</th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500, textAlign: "right" }}>Amount Due</th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Due Date</th>
              <th style={{ padding: "12px 24px", fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                style={{
                  borderBottom: "1px solid #f3f4f6",
                  // #6: highlight selected rows
                  background: selected.has(inv.id) ? "#eff6ff" : "transparent",
                }}
              >
                {/* #6 Bulk Operations: per-row checkbox */}
                <td style={{ padding: "16px 12px 16px 24px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(inv.id)}
                    onChange={() => toggleSelect(inv.id)}
                    style={{ cursor: "pointer" }}
                  />
                </td>
                <td style={{ padding: "16px 24px", fontWeight: 600, color: "#111827" }}>
                  {inv.invoice_number}
                  {/* #5 Void + Revise: show which invoice this was revised from */}
                  {inv.revised_from && (
                    <span style={{ display: "block", fontSize: "11px", color: "#6b7280", fontWeight: 400 }}>
                      revised from {invoices.find((i) => i.id === inv.revised_from)?.invoice_number || inv.revised_from}
                    </span>
                  )}
                </td>
                <td style={{ padding: "16px 24px", color: "#374151" }}>{inv.customer_name}</td>
                <td style={{ padding: "16px 24px" }}>{statusBadge(inv.status)}</td>
                <td style={{ padding: "16px 24px", textAlign: "right", fontFamily: "monospace", color: "#111827" }}>
                  {formatCents(inv.total)}
                </td>
                <td style={{ padding: "16px 24px", textAlign: "right", fontFamily: "monospace", color: "#111827" }}>
                  {formatCents(inv.amount_due)}
                </td>
                <td style={{ padding: "16px 24px", fontSize: "14px", color: "#6b7280" }}>
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "16px 24px" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {/* draft → open (finalize) */}
                    {inv.status === "draft" && (
                      <button onClick={() => handleFinalize(inv.id)} style={btnStyle("#2563eb", "#ffffff")}>
                        Finalize
                      </button>
                    )}
                    {/* draft → deleted */}
                    {inv.status === "draft" && (
                      <button onClick={() => handleDelete(inv.id)} style={btnStyle("#fee2e2", "#dc2626")}>
                        Delete
                      </button>
                    )}
                    {/* open → paid (record payment) */}
                    {inv.status === "open" && (
                      <button onClick={() => handlePayFull(inv.id, inv.amount_due)} style={btnStyle("#16a34a", "#ffffff")}>
                        Record Payment
                      </button>
                    )}
                    {/* open → void */}
                    {inv.status === "open" && (
                      <button onClick={() => handleVoid(inv.id)} style={btnStyle("#e5e7eb", "#374151")}>
                        Void
                      </button>
                    )}
                    {/* #5 Void + Revise: open → void + new draft */}
                    {inv.status === "open" && (
                      <button onClick={() => handleRevise(inv.id)} style={btnStyle("#7c3aed", "#ffffff")}>
                        Revise
                      </button>
                    )}
                    {/* open → uncollectible (write off) */}
                    {inv.status === "open" && (
                      <button onClick={() => handleMarkUncollectible(inv.id)} style={btnStyle("#f97316", "#ffffff")}>
                        Write Off
                      </button>
                    )}
                    {/* uncollectible → void */}
                    {inv.status === "uncollectible" && (
                      <button onClick={() => handleVoid(inv.id)} style={btnStyle("#e5e7eb", "#374151")}>
                        Void
                      </button>
                    )}
                    {/* #4 Credit Notes: refund button for paid or open invoices */}
                    {(inv.status === "paid" || inv.status === "open") && (
                      <button onClick={() => handleRefund(inv)} style={btnStyle("#dc2626", "#ffffff")}>
                        Refund
                      </button>
                    )}
                    {/* paid — show settled label */}
                    {inv.status === "paid" && (
                      <span style={{ fontSize: "13px", color: "#9ca3af" }}>Settled</span>
                    )}
                    {/* void — terminal */}
                    {inv.status === "void" && (
                      <span style={{ fontSize: "13px", color: "#9ca3af" }}>Voided</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
