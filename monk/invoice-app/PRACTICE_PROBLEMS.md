# Invoice Lifecycle - Practice Problems & Prep Guide (Stripe Model)

---

## Stripe Invoice States & Actions (Know This Cold)

### The 5 States:
```
draft ──finalize──→ open ──payment──→ paid (terminal)
  │                  │  │
  │ delete           │  │ write off
  ↓                  │  ↓
(deleted)            │  uncollectible
                     │       │
                     │ void  │ void
                     ↓       ↓
                    void (terminal)
```

| State | Meaning |
|---|---|
| **Draft** | Editable. Not yet finalized. Can add/remove line items, change customer, tax rate, etc. |
| **Open** | Finalized and sent to customer. Has `finalized_at` and `due_date`. Line items are now immutable. Awaiting payment. |
| **Paid** | Fully paid (`amount_due === 0`). Records `paid_at`. Terminal state. |
| **Void** | Cancelled. Cannot collect payment. Keeps history but zeroes out `amount_due`. Terminal state. |
| **Uncollectible** | Deemed unlikely to be paid (customer unresponsive, bankrupt, etc.). Keeps `amount_due` for accounting but treated as a write-off/loss. Can still be voided. |

Note: **"Overdue" is not a status** — it's a display concern. An `open` invoice past its `due_date` can be shown as overdue in the UI, but the DB status stays `open`. This avoids needing a cron job. If asked: *"I'd derive overdue at read time: `status === 'open' && due_date < now`."*

### The 5 Operations:

| Operation | What it does | Transition |
|---|---|---|
| **Create** | Creates a new invoice | → `draft` |
| **Edit** | Modifies line items, customer, tax, memo | `draft` → `draft` (only drafts are editable) |
| **Finalize** | Locks the invoice and makes it payable | `draft` → `open` |
| **Track Payment** | Records a full or partial payment | `open` → `open` (partial) or `open` → `paid` (full) |
| **Manage Status** | Transitions between states | `open` → `void`, `open` → `uncollectible`, etc. |

### Valid Transitions:
| From | To | Action | API Endpoint |
|---|---|---|---|
| draft | draft | Edit (update line items, customer, tax, memo) | `PATCH /api/invoices/:id` |
| draft | open | Finalize | `POST /api/invoices/:id/finalize` |
| draft | *(deleted)* | Delete | `DELETE /api/invoices/:id` |
| open | paid | Record Payment (when fully paid) | `POST /api/invoices/:id/payments` |
| open | void | Void | `POST /api/invoices/:id/void` |
| open | uncollectible | Write Off | `POST /api/invoices/:id/mark-uncollectible` |
| uncollectible | void | Void | `POST /api/invoices/:id/void` |
| paid | — | Terminal (no transitions) | — |
| void | — | Terminal (no transitions) | — |

### Invalid Transitions (know these too):
| Attempt | Error | Why |
|---|---|---|
| open → draft | 400 "Cannot revert to draft" | Finalized invoices are immutable |
| paid → void | 400 "Cannot void a paid invoice" | Money collected — issue credit note instead |
| paid → anything | 400 "Paid is a terminal state" | Use credit notes for adjustments |
| void → anything | 400 "Void is a terminal state" | Create a new invoice instead |
| draft → paid | 400 "Must finalize before accepting payment" | Can't pay a draft |
| uncollectible → paid | 400 "Cannot pay an uncollectible invoice" | Must void and re-create if customer decides to pay |
| uncollectible → open | 400 "Cannot reopen" | Void it and create a new invoice |

---

## Edge Cases & Design Decisions Cheat Sheet

### 1. `amount_due` — Stored vs Derived

| Approach | Pros | Cons |
|---|---|---|
| **Store it** (recalculate on every payment write) | Fast reads, no joins needed | Can go out of sync if update logic has a bug |
| **Derive it** (`total - sum(payments)`) | Always correct, single source of truth | Requires querying payments on every read |

**Recommendation**: Either works. If you store it, always recalculate server-side on every payment. Never trust the client. Mention: *"In production I might derive it for correctness, but storing it is fine if I recalculate on every write."*

### 2. Optimistic Locking (`version` field)

**Problem**: Two people edit the same draft invoice simultaneously. Person A saves, then Person B saves and overwrites A's changes.

**Solution**: Add a `version` integer to invoices. On every update:
```
PATCH /invoices/:id  { version: 3, line_items: [...] }
→ Server checks: is current version === 3?
→ Yes: update and set version = 4
→ No: return 409 Conflict "Invoice was modified by someone else"
```

**When to mention**: When they ask about concurrency or "what if two people edit the same invoice?"

### 3. Idempotency Key on Payments

**Problem**: User double-clicks "Pay" button. Network retries the same request. You charge them twice.

**Solution**: Client generates a unique `idempotency_key` per payment attempt:
```json
POST /invoices/:id/payments
{ "amount": 50000, "method": "credit_card", "idempotency_key": "pay_abc123" }
```
Server checks: have I seen this key before? If yes, return the original response. If no, process the payment.

**When to mention**: When discussing payments, double-submit prevention, or reliability.

### 4. Money — Always Cents, Never Floats

```
BAD:  total: 49.99  (floating point: 0.1 + 0.2 = 0.30000000000000004)
GOOD: total: 4999   (integer cents, display as $49.99 in UI)
```

**Rule**: Store all monetary values as integers in cents. Convert to dollars only at display time. This is what Stripe does.

### 5. Invoice Immutability After Finalizing

Once an invoice is **finalized** (status = `open`), you cannot edit:
- Line items (description, quantity, price)
- Customer
- Tax rate

You CAN still:
- Record payments against it
- Void it
- Mark it uncollectible
- Issue a credit note against it (if paid)

**Why**: Financial records must be auditable. If you change a finalized invoice, the customer's copy won't match yours.

**If they need to change something**: Void the original, create a new corrected invoice.

### 6. Invoice Numbering — Preventing Collisions

| Approach | Pros | Cons |
|---|---|---|
| Auto-increment counter | Simple, sequential (INV-0001, INV-0002) | Race condition if two invoices created simultaneously |
| UUID | No collisions ever | Not human-friendly |
| Counter + unique constraint | Sequential AND safe | Need retry logic on constraint violation |

**Recommendation**: Sequential counter with a unique DB constraint. If collision, retry with next number.

### 7. Partial Payments — Edge Cases

- **Overpayment**: `amount > amount_due` → reject with 400 error
- **Exact payment**: `amount === amount_due` → mark invoice as `paid`
- **Partial payment**: `amount < amount_due` → reduce `amount_due`, status stays `open`
- **Payment on wrong status**: Can only pay `open` — not `draft`, `paid`, `void`, `uncollectible`
- **Zero amount**: Reject payments of $0.00

### 8. Concurrent Payment Attempts

**Problem**: Two people pay the same invoice at the same time. Total is $100. Each pays $100. You collect $200.

**Solution in SQL**: Use a transaction with row-level locking:
```sql
BEGIN;
SELECT amount_due FROM invoices WHERE id = ? FOR UPDATE;  -- locks the row
-- check amount_due >= payment_amount
UPDATE invoices SET amount_due = amount_due - ? WHERE id = ?;
INSERT INTO payments (...) VALUES (...);
COMMIT;
```

**In JSON file**: Not really possible (single-threaded Node.js helps, but not safe at scale). Mention: *"This is one reason we'd use SQL in production — transactions and row locking."*

### 9. Soft Delete vs Hard Delete

- **Drafts**: Can be hard deleted (never finalized, no financial record)
- **Open/Paid/Void/Uncollectible**: NEVER delete. Use void status instead. Financial records must be preserved for auditing.

**Say**: *"I only allow deleting draft invoices. Anything that's been finalized is a financial record and gets voided, not deleted."*

### 10. Void vs Uncollectible — When to Use Which

| | Void | Uncollectible |
|---|---|---|
| **When** | Invoice was sent in error, wrong amount, wrong customer | Customer can't/won't pay after collection attempts |
| **amount_due** | Set to 0 | Kept as-is (for accounting/bad debt records) |
| **Accounting** | Treated as if invoice never existed | Recorded as bad debt / write-off |
| **Next step** | None (terminal) | Can still be voided |
| **From states** | open, uncollectible (drafts are deleted, not voided) | open only |

### 11. Voiding an Invoice with Partial Payments

**Problem**: Invoice total is $1000. Customer already paid $500. Now you need to void it.

**Options**:
| Approach | Pros | Cons |
|---|---|---|
| **Block voiding** if any payments exist | Simplest, safest | Forces refund workflow first |
| **Allow voiding** but auto-create refund records | More flexible | Complex, need refund logic |

**Recommendation**: Block voiding if payments exist. Return: `400 "Cannot void invoice with existing payments. Process refunds first."`

**Say**: *"If there are partial payments, I'd require refunds before allowing void. This keeps the financial records clean."*

### 12. Finalizing a Zero-Total Invoice

**Problem**: All line items add up to $0 (e.g., 100% discount, free trial, promotional invoice).

**Stripe's behavior**: Allows it — auto-transitions to `paid` since amount_due is already 0.

**Your logic**:
```
if (invoice.total === 0) {
  invoice.status = "paid";
  invoice.paid_at = now;
} else {
  invoice.status = "open";
}
```

**Say**: *"A $0 invoice is valid — think free trials or promotional credits. I'd auto-mark it as paid on finalize since there's nothing to collect."*

### 13. Revised Invoice and Overpayment Scenario

**Problem**: Original invoice was $1000, customer paid $800. You void it and create a revised invoice for $500. Now you've collected $800 on a $500 invoice — $300 overpaid.

**Solution**: The void + revise flow should:
1. Block voiding if payments exist (see #11), OR
2. Create a credit/refund for the difference automatically
3. The revised invoice starts fresh — new `amount_due = $500`, no carried-over payments

**Say**: *"Revising a partially paid invoice is tricky. I'd require full refund of the original before voiding, then the customer pays the new corrected invoice from scratch."*

### 14. `revised_from` — Linking Corrected Invoices

**Problem**: You void INV-0001 and create INV-0002 as the correction. How do you trace the history?

**Solution**: Add `revised_from` field (nullable FK) on the invoice schema:
```json
{
  "id": "inv_002",
  "invoice_number": "INV-0002",
  "revised_from": "inv_001",
  "status": "draft"
}
```

This lets you show revision history on the UI and trace the audit trail.

---

## Practice Problem 1: Partial Payments & Payment History

**Scenario**: Extend the current app to support partial payments with a full payment history view.

**Requirements**:
- When recording a payment, allow any amount from $0.01 up to the remaining `amount_due`
- Show a payment history panel for each invoice (list of all payments with date, amount, method)
- Add a "Partially Paid" visual indicator when an open invoice has payments but isn't fully paid
- Add a summary: "Paid $X of $Y (Z remaining)"

**Edge cases to handle**:
- Overpayment attempt → reject with clear error
- Double-click / duplicate submission → idempotency key
- Payment on a void/draft/uncollectible invoice → reject (only `open` accepts payments)
- Concurrent payments that would exceed total → transaction + row lock (mention for SQL)
- Payment amount of $0 → reject

**Schema design to discuss**:
- Payments as a separate table (not embedded) — you query them independently, and they're an append-only ledger
- `idempotency_key` on payments table to prevent duplicates
- `amount_due` recalculated server-side on every payment (never trust client-sent amount_due)
- Should `amount_due` be stored or derived? Trade-offs of each

**What they're evaluating**: Data modeling, state management, financial data integrity, handling edge cases.

---

## Practice Problem 2: Invoice Creation Form with Line Items

**Scenario**: Build a complete "Create Invoice" form with dynamic line items.

**Requirements**:
- Customer selector (dropdown from existing customers)
- Dynamic line items: add/remove rows, each with description, quantity, unit price
- Auto-calculate: line amount = qty × price, subtotal, tax (configurable rate), total
- Tax rate selector (0%, 5%, 8%, 10%)
- Memo field
- "Save as Draft" and "Finalize Now" buttons
- Validate: at least 1 line item, all amounts > 0, customer selected

**Edge cases to handle**:
- Invoice number collision → unique constraint + retry, or UUID
- Negative quantities or prices → reject on both client and server
- Extremely large amounts → integer overflow in cents (mention: use BigInt or cap max amount)
- Empty line item description → require non-empty
- Saving while another user creates an invoice (number collision) → server generates number, not client
- "Finalize Now" should create as draft then immediately finalize (two logical steps, one API call is fine)

**Schema design to discuss**:
- Line items: separate table (SQL) vs embedded array (JSON) — trade-offs of each
- Invoice numbering strategy — sequential with unique constraint
- All amounts in cents — never floats
- Server computes all totals — never trust client-calculated amounts
- `version` field for optimistic locking if multiple editors

**What they're evaluating**: Form state management, validation (client AND server), clean API design, data integrity.

---

## Practice Problem 3: Dashboard & Metrics

**Scenario**: Build a dashboard that shows key metrics with filtering and sorting.

**Requirements**:
- Dashboard cards: Total Outstanding, Paid This Month, Total Revenue, Uncollectible (write-offs)
- Filter invoices by status (tabs: All, Draft, Open, Paid, Void, Uncollectible)
- Sort by: date created, due date, amount, customer name
- Visual indicator for open invoices past their `due_date` (display as "overdue" in UI, but DB status is still `open`)
- "Send Reminder" button on past-due open invoices (updates `last_reminder_sent` timestamp)
- "Write Off" button on past-due open invoices (transitions to uncollectible)

**Edge cases to handle**:
- "Overdue" is a display concern, not a stored status — filter as `status === "open" && due_date < now`
- Invoice due today at midnight — define clearly: overdue means `due_date < start_of_today` (not <=)
- Timezone handling — store all dates as UTC, convert to local for display
- "Send Reminder" clicked twice rapidly — idempotent (just updates timestamp, no duplicate emails)
- Dashboard totals must match the filtered list — compute from same data source
- Uncollectible invoices should NOT show as "overdue" even if past due

**Schema design to discuss**:
- `last_reminder_sent` field on invoice — or separate `reminders` table for full history?
- How would reminder emails work at scale? → Message queue, not inline API call
- Indexing strategy for SQL: index on `status`, `due_date`, `customer_id`
- Aggregation queries for dashboard metrics — compute server-side, not client-side

**What they're evaluating**: Derived display state vs stored state, filtering/sorting, business logic placement.

---

## Practice Problem 4: Credit Notes & Refunds

**Scenario**: A customer disputes a charge on a paid invoice. Build the credit note system.

**Requirements**:
- Create a "Credit Note" against a paid invoice (full or partial refund)
- Credit note references the original invoice and specific line items
- Adjusts the customer's balance
- Shows credit note history on the invoice detail page
- Cannot credit more than the original invoice total

**Edge cases to handle**:
- Multiple credit notes on same invoice — total credits cannot exceed invoice total
- Credit note on an open invoice — not allowed (just void it instead)
- Credit note on a void invoice — not allowed
- Refund amount of $0 → reject
- Credit note should be immutable once created (like invoices after finalizing)
- Currency precision — credit amount must be in cents, matching original invoice currency

**Schema design to discuss**:
- Credit notes as a separate entity (not a "negative invoice") with `invoice_id` FK
- Credit note numbering: CN-0001 (separate sequence from invoices)
- `credit_note_items` table referencing original `line_items` — or just a flat amount?
- Impact on `amount_due`: paid invoice's amount_due stays 0, credit note creates a customer balance/credit
- Immutability: credit notes cannot be edited or deleted, only voided themselves
- Financial reporting: revenue - credits = net revenue

**What they're evaluating**: Complex entity relationships, financial data integrity, immutability of financial records, accounting concepts.

---

## Practice Problem 5: Void + Revise Workflow (HIGHLY LIKELY TO BE ASKED)

**Scenario**: A finalized invoice (open, sent to customer) has wrong line items. Build the void-and-revise flow.

**Requirements**:
- User clicks "Revise" on an open invoice
- System voids the original invoice automatically
- System creates a new draft invoice pre-filled with the original's data
- New invoice has `revised_from` pointing to voided original
- New invoice gets a NEW invoice number (INV-0002, not INV-0001)
- User edits the draft, then finalizes when ready
- UI shows revision history: INV-0002 → revised from INV-0001 (voided)

**Edge cases to handle**:
- Revising an invoice with partial payments → block it, require refund first
- Revising a draft → not needed, just edit it directly
- Revising a paid invoice → not allowed, use credit notes instead
- Revising a void invoice → not allowed, already canceled
- Double-click on "Revise" button → idempotency, check if already voided
- Revision chain: INV-0001 → voided → INV-0002 → voided → INV-0003. Show full chain in UI

**API Design**:
```
POST /api/invoices/:id/revise
  Request:  { "reason": "Wrong quantities" }
  Response: {
    "voided_invoice": { ...original with status: "void" },
    "new_invoice": { ...draft copy with revised_from: "inv_001" }
  }
```

**Server logic** (two atomic steps):
1. Validate: must be `open`, no payments exist
2. Set original status = `void`, voided_at = now
3. Create new draft with same customer, line items, tax — but new ID, new number
4. Set `revised_from = original.id` on the new draft

**What they're evaluating**: Immutability thinking, multi-step atomic operations, referential integrity, audit trail.

---

## Practice Problem 6: Bulk Operations & Batch Finalization

**Scenario**: User has 20 draft invoices and wants to finalize them all at once for month-end billing.

**Requirements**:
- "Select All" checkbox on invoice list + "Bulk Finalize" button
- API accepts array of invoice IDs to finalize
- Each invoice validated independently (some may fail, others succeed)
- Return detailed results: which succeeded, which failed and why
- Also support bulk void (for canceling a batch of invoices)

**Edge cases to handle**:
- Mixed statuses in selection — some drafts, some already open → skip non-drafts, report as "already finalized"
- One invoice has no line items → fails validation, others still finalize
- Invoice in the batch was deleted by another user between selection and submission → 404 for that one, others proceed
- Extremely large batch (500 invoices) → should you process inline or queue it?
- Concurrent bulk operations on overlapping invoice sets → version check on each

**API Design**:
```
POST /api/invoices/bulk-finalize
  Request:  { "invoice_ids": ["inv_001", "inv_002", "inv_003"] }
  Response: {
    "results": [
      { "id": "inv_001", "success": true, "status": "open" },
      { "id": "inv_002", "success": false, "error": "No line items" },
      { "id": "inv_003", "success": true, "status": "open" }
    ],
    "summary": { "succeeded": 2, "failed": 1 }
  }
```

**Key design decision**: Should this be **all-or-nothing** (transaction) or **partial success**?
- All-or-nothing: simpler, but one bad invoice blocks everything
- Partial success: better UX, but client must handle mixed results

**Recommendation**: Partial success. Each invoice is independent — one failing shouldn't block others.

**What they're evaluating**: API design for batch operations, error handling strategy, partial vs atomic operations, scalability thinking.

---

## Preparing for the Non-AI Planning Stage

The initial planning stage is where you CANNOT use AI tools. This is typically 10-15 minutes where they assess your raw thinking. Here's what to focus on:

### What They're Looking For:

1. **Schema Design Thinking**
   - Draw out entities and relationships (Customers, Invoices, LineItems, Payments)
   - Think about: primary keys, foreign keys, timestamps, status enums, unique constraints
   - Normalization vs denormalization trade-offs
   - "All money in cents" — say it early

2. **State Machine Thinking (Stripe Model)**
   - 5 states: draft, open, paid, void, uncollectible
   - 5 operations: create, edit, finalize, track payment, manage status
   - Draw the full state diagram with valid AND invalid transitions
   - State invariants: "a void invoice cannot accept payments", "can't pay a draft"
   - Void vs uncollectible — know the difference
   - Paid and void are terminal — uncollectible can still be voided

3. **Data Integrity Thinking**
   - Optimistic locking (`version` field) for concurrent edits
   - Idempotency keys for payment deduplication
   - Immutability of finalized invoices (void + re-create, don't edit)
   - Server-side validation — never trust client calculations
   - Transactions for payment processing (in SQL)

4. **API Design**
   - RESTful resource modeling with action endpoints for state transitions:
   ```
   POST   /api/invoices                         → Create (draft)
   GET    /api/invoices                         → List all
   GET    /api/invoices/:id                     → Get single
   PATCH  /api/invoices/:id                     → Edit (draft only)
   DELETE /api/invoices/:id                     → Delete (draft only)
   POST   /api/invoices/:id/finalize            → Finalize (draft → open)
   POST   /api/invoices/:id/payments            → Track Payment (open only)
   GET    /api/invoices/:id/payments            → List Payments
   POST   /api/invoices/:id/void               → Void (open/uncollectible only, drafts use DELETE)
   POST   /api/invoices/:id/mark-uncollectible  → Write Off (open only)
   ```
   - HTTP status codes: 201 Created, 400 Bad Request, 404 Not Found, 409 Conflict
   - Error format: `{ "error": "Only draft invoices can be finalized" }`

5. **Prioritization**
   - What do you build first? (Schema → API → UI)
   - What's MVP vs nice-to-have?
   - Timebox: "I'll spend 20 min on API, 20 min on UI, 10 min on polish"

### How to Practice (Without AI):

1. **Draw the schema on paper** — 5 min to sketch all tables, columns, relationships, constraints.

2. **Write the state machine** — All 5 states, all valid transitions, all invalid transitions with error codes. Practice drawing this:
   ```
   draft ──finalize──→ open ──payment──→ paid (terminal)
     │                   │
     │delete             │void        │write off
     ↓                   ↓            ↓
   (deleted)           void ←───── uncollectible
                     (terminal)
   ```

3. **Plan your API routes on paper** — endpoints, request body shapes, response shapes.

4. **Practice talking through trade-offs out loud**:
   - "I'd store payments in a separate table because they're an append-only ledger queried independently."
   - "Overdue isn't a status — it's a display concern. I'd derive it: open + past due_date."
   - "I'd add a version field for optimistic locking to handle concurrent edits."
   - "I'd use an idempotency key on payments to prevent double-charging."
   - "All money in cents as integers — floats cause rounding errors."
   - "Finalized invoices are immutable. To fix one, void it and create a new one."
   - "Void means the invoice was wrong. Uncollectible means the customer won't pay."
   - "Only drafts can be deleted. Everything else is a financial record."

5. **Know your framework cold**: Scaffold a Next.js API route, create a React form with useState, wire up a fetch call — from memory, no AI.

### Quick Reference — Schema Sketch (Practice Drawing This):

```
CUSTOMERS
  id          PK
  name        string NOT NULL
  email       string NOT NULL UNIQUE
  address     string
  created_at  timestamp

INVOICES
  id                       PK
  invoice_number           string NOT NULL UNIQUE
  status                   enum(draft,open,paid,void,uncollectible) NOT NULL DEFAULT 'draft'
  customer_id              FK → customers(id) NOT NULL
  subtotal                 integer NOT NULL  (cents)
  tax_rate                 decimal NOT NULL DEFAULT 0
  tax_amount               integer NOT NULL  (cents)
  total                    integer NOT NULL  (cents)
  amount_due               integer NOT NULL  (cents)
  version                  integer NOT NULL DEFAULT 1  (optimistic locking)
  finalized_at             timestamp NULL    (when draft → open)
  due_date                 timestamp NULL
  paid_at                  timestamp NULL
  voided_at                timestamp NULL
  marked_uncollectible_at  timestamp NULL
  memo                     text
  revised_from             FK → invoices(id) NULL  (links corrected invoice to voided original)
  created_at               timestamp NOT NULL
  updated_at               timestamp NOT NULL

LINE_ITEMS
  id            PK
  invoice_id    FK → invoices(id) NOT NULL
  description   string NOT NULL
  quantity      integer NOT NULL
  unit_price    integer NOT NULL  (cents)
  amount        integer NOT NULL  (cents, = quantity × unit_price)

PAYMENTS
  id                PK
  invoice_id        FK → invoices(id) NOT NULL
  idempotency_key   string UNIQUE  (prevent duplicate payments)
  amount            integer NOT NULL  (cents)
  method            enum(credit_card,bank_transfer,check,cash)
  paid_at           timestamp NOT NULL
  note              text

CREDIT_NOTES (if needed)
  id            PK
  invoice_id    FK → invoices(id) NOT NULL
  amount        integer NOT NULL  (cents)
  reason        text NOT NULL
  created_at    timestamp NOT NULL
```

### Common Interview Follow-Up Questions:

- **"How would you handle currency?"** → Store in cents as integers, never floats. Display conversion in UI only.
- **"What if two people edit the same draft?"** → Optimistic locking with `version` field. Return 409 Conflict on mismatch.
- **"How do you prevent duplicate payments?"** → Idempotency key on every payment request. Server deduplicates.
- **"What about overdue invoices?"** → Not a stored status. Derive it: `status === 'open' && due_date < now`. No cron job needed. Show it as a display label in the UI.
- **"What's the difference between void and uncollectible?"** → Void = invoice was wrong (zeroes out amount_due, terminal). Uncollectible = customer won't pay (keeps amount_due for bad debt accounting, can still be voided).
- **"How would you add recurring invoices?"** → Invoice template entity + cron job that generates drafts on schedule, auto-finalize optional.
- **"How would you generate PDF invoices?"** → Server-side rendering (e.g., Puppeteer or a PDF library). Queue job for async.
- **"How would you handle multiple currencies?"** → Store `currency_code` per invoice. Convert at payment time using exchange rate table.
- **"Why can't you edit a finalized invoice?"** → Financial record immutability. Void and re-create instead. Audit trail.
- **"How would you handle refunds on a paid invoice?"** → Credit note entity referencing original invoice. Separate from payments. Never modify the paid invoice.
- **"What about taxes per line item vs invoice level?"** → Start with invoice-level. Per-line-item adds a `tax_rate` column to line_items for mixed-tax scenarios.
- **"How would you handle an uncollectible invoice that the customer eventually pays?"** → Void the uncollectible invoice, create a new open invoice, then record the payment against it.
- **"Can you delete a finalized invoice?"** → Never. Only drafts can be deleted. Finalized invoices are financial records — void them instead.
