import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api-client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const emptyLine = () => ({ description: "", quantity: "1", rate: "" });
const today = () => new Date().toISOString().slice(0, 10);

function parseMinor(value) {
  if (value === "") return 0n;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value);
  if (!match) return null;
  const result = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? result : null;
}

function parseQuantityMilli(value) {
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(value);
  if (!match) return null;
  const quantity = BigInt(match[1]) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  return quantity > 0n && quantity <= 100000000n ? Number(quantity) : null;
}

function money(value) {
  const amount = BigInt(value ?? 0);
  const whole = amount / 100n;
  const fraction = String(amount % 100n).padStart(2, "0");
  return `₱${new Intl.NumberFormat("en-PH").format(whole)}.${fraction}`;
}

function minorInput(value) {
  const amount = BigInt(value ?? 0);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

function lineAmount(line) {
  const quantity = parseQuantityMilli(line.quantity);
  const rate = parseMinor(line.rate);
  if (quantity === null || rate === null) return null;
  return (BigInt(quantity) * rate + 500n) / 1000n;
}

function taxAmount(subtotalMinor, taxRateBps) {
  return (subtotalMinor * BigInt(taxRateBps) + 5000n) / 10000n;
}

const statuses = ["all", "draft", "sent", "partially paid", "paid", "overdue", "void"];

function StatusBadge({ status }) {
  const color = status === "paid" ? "border-green-200 bg-green-50 text-green-700"
    : status === "overdue" ? "border-red-200 bg-red-50 text-red-700"
      : status === "draft" ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-blue-200 bg-blue-50 text-blue-700";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${color}`}>{status}</span>;
}

function printInvoice(invoice, lines) {
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow pop-ups to print this invoice.");
  preview.opener = null;
  const doc = preview.document;
  doc.title = `Invoice ${invoice.invoiceNumber}`;
  const style = doc.createElement("style");
  style.textContent = "body{font:14px Arial,sans-serif;margin:40px;color:#111}h1{margin-bottom:4px}small{color:#555}.meta{margin:24px 0}.meta p{margin:6px 0}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border-bottom:1px solid #ddd;padding:10px;text-align:left}td:last-child,th:last-child{text-align:right}.total{text-align:right;font-size:18px;font-weight:bold;margin-top:20px}@media print{button{display:none}}";
  doc.head.append(style);
  const body = doc.body;
  const heading = doc.createElement("h1");
  heading.textContent = "Invoice";
  body.append(heading);
  const number = doc.createElement("small");
  number.textContent = invoice.invoiceNumber;
  body.append(number);
  const meta = doc.createElement("div");
  meta.className = "meta";
  for (const [label, value] of [
    ["Customer", invoice.customerName],
    ["Invoice date", invoice.invoiceDate],
    ["Due date", invoice.dueDate],
    ["Reference", invoice.reference || "—"],
  ]) {
    const p = doc.createElement("p");
    p.textContent = `${label}: ${value}`;
    meta.append(p);
  }
  body.append(meta);
  const table = doc.createElement("table");
  const head = doc.createElement("tr");
  for (const label of ["Description", "Qty", "Rate", "Amount"]) {
    const cell = doc.createElement("th");
    cell.textContent = label;
    head.append(cell);
  }
  table.append(head);
  for (const line of lines) {
    const row = doc.createElement("tr");
    const values = [
      line.description,
      (Number(line.quantityMilli) / 1000).toFixed(3).replace(/\.?0+$/, ""),
      money(line.unitPriceMinor),
      money(line.amountMinor),
    ];
    for (const value of values) {
      const cell = doc.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    table.append(row);
  }
  body.append(table);
  for (const [label, amount, bold] of [
    ["Subtotal", invoice.subtotalMinor, false],
    ["Tax [VERIFY]", invoice.taxMinor, false],
    ["Total due", invoice.totalMinor, true],
  ]) {
    const total = doc.createElement(bold ? "h2" : "p");
    total.className = "total";
    total.textContent = `${label}: ${money(amount)}`;
    body.append(total);
  }
  const verify = doc.createElement("p");
  verify.textContent = "Tax treatment and invoice format [VERIFY] — review with a licensed Philippine CPA or tax counsel.";
  body.append(verify);
  preview.focus();
  preview.print();
}

export default function SalesReceivablesPage({
  companyId,
  canView = true,
  isCheckingAccess = false,
  permissionError = "",
}) {
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [aging, setAging] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [section, setSection] = useState("invoices");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState("");
  const [customerForm, setCustomerForm] = useState({ name: "", email: "", phone: "", billingAddress: "" });
  const [paymentForm, setPaymentForm] = useState({ customerId: "", paymentDate: today(), amount: "", reference: "", allocations: {}, creditOnAccount: false });
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  });
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [invoiceDraftId, setInvoiceDraftId] = useState("");
  const [editingInvoiceId, setEditingInvoiceId] = useState("");
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + (lineAmount(line) ?? 0n), 0n), [lines]);
  const taxRateBps = /^\d{1,3}(?:\.\d{0,2})?$/.test(taxRate) && Number(taxRate) <= 100
    ? Math.round(Number(taxRate) * 100)
    : null;
  const tax = taxRateBps === null ? 0n : taxAmount(subtotal, taxRateBps);
  const total = subtotal + tax;
  const validLines = lines.every((line) => line.description.trim() && parseQuantityMilli(line.quantity) !== null && lineAmount(line) !== null);
  const canSaveInvoice = Boolean(companyId && invoiceCustomerId && validLines && subtotal > 0n && taxRateBps !== null && dueDate >= invoiceDate);

  const load = async () => {
    if (!companyId || isCheckingAccess || !canView) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ companyId });
      const [customerResult, invoiceResult, summaryResult, agingResult, paymentResult] = await Promise.all([
        apiRequest(`/api/sales/customers?${query}`),
        apiRequest(`/api/sales/invoices?${query}`),
        apiRequest(`/api/sales/summary?${query}`),
        apiRequest(`/api/sales/aging?${query}`),
        apiRequest(`/api/sales/payments?${query}`),
      ]);
      setCustomers(Array.isArray(customerResult?.data) ? customerResult.data : []);
      setInvoices(Array.isArray(invoiceResult?.data) ? invoiceResult.data : []);
      setSummary(summaryResult?.data ?? null);
      setAging(agingResult?.data ?? null);
      setPayments(Array.isArray(paymentResult?.data) ? paymentResult.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load sales and receivables.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!companyId) return undefined;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ companyId });
        const [customerResult, invoiceResult, summaryResult, agingResult, paymentResult] = await Promise.all([
          apiRequest(`/api/sales/customers?${query}`),
          apiRequest(`/api/sales/invoices?${query}`),
          apiRequest(`/api/sales/summary?${query}`),
          apiRequest(`/api/sales/aging?${query}`),
          apiRequest(`/api/sales/payments?${query}`),
        ]);
        if (!active) return;
        setCustomers(Array.isArray(customerResult?.data) ? customerResult.data : []);
        setInvoices(Array.isArray(invoiceResult?.data) ? invoiceResult.data : []);
        setSummary(summaryResult?.data ?? null);
        setAging(agingResult?.data ?? null);
        setPayments(Array.isArray(paymentResult?.data) ? paymentResult.data : []);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load sales and receivables.");
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => { active = false; };
  }, [canView, companyId, isCheckingAccess]);

  useEffect(() => {
    let active = true;
    if (!selectedId || !companyId || !canView) return undefined;
    const query = new URLSearchParams({ companyId });
    apiRequest(`/api/sales/invoices/${encodeURIComponent(selectedId)}?${query}`)
      .then((result) => { if (active) setDetail(result?.data ?? null); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load invoice."); });
    return () => { active = false; };
  }, [canView, companyId, selectedId]);

  const saveCustomer = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/sales/customers", {
        method: "POST",
        body: { companyId, ...customerForm, email: customerForm.email || null },
      });
      setCustomerForm({ name: "", email: "", phone: "", billingAddress: "" });
      setShowCustomerForm(false);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save customer.");
    } finally {
      setSaving(false);
    }
  };

  const updateLine = (index, key, value) =>
    setLines((current) => current.map((line, position) => position === index ? { ...line, [key]: value } : line));

  const clearInvoiceForm = () => {
    setEditingInvoiceId("");
    setInvoiceDraftId("");
    setInvoiceCustomerId("");
    setInvoiceNumber("");
    setReference("");
    setDescription("");
    setTaxRate("0");
    setLines([emptyLine()]);
    setInvoiceDate(today());
    const date = new Date();
    date.setDate(date.getDate() + 30);
    setDueDate(date.toISOString().slice(0, 10));
  };

  const saveInvoice = async (event, issueAfterSave = false) => {
    event.preventDefault();
    if (!canSaveInvoice) return;
    setSaving(true);
    setError("");
    try {
      const editingId = editingInvoiceId || (issueAfterSave ? invoiceDraftId : "");
      const requestBody = {
        companyId,
        customerId: invoiceCustomerId,
        invoiceNumber: invoiceNumber.trim() || null,
        invoiceDate,
        dueDate,
        currency: "PHP",
        reference: reference.trim() || null,
        description: description.trim() || null,
        taxRateBps,
        lines: lines.map((line) => ({
          description: line.description.trim(),
          quantityMilli: parseQuantityMilli(line.quantity),
          unitPriceMinor: Number(parseMinor(line.rate)),
        })),
      };
      const saved = await apiRequest(
        editingId ? `/api/sales/invoices/${encodeURIComponent(editingId)}` : "/api/sales/invoices",
        {
          method: editingId ? "PUT" : "POST",
          body: requestBody,
        },
      );
      const invoiceId = editingId || saved?.data?.id;
      if (!editingId && saved?.data?.id) setInvoiceDraftId(saved.data.id);
      if (issueAfterSave && invoiceId) {
        await apiRequest(`/api/sales/invoices/${encodeURIComponent(invoiceId)}/issue`, {
          method: "POST",
          body: { companyId },
        });
      }
      clearInvoiceForm();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save invoice.");
    } finally {
      setSaving(false);
    }
  };

  const editDraft = (invoice, invoiceLines) => {
    setEditingInvoiceId(invoice.id);
    setInvoiceDraftId("");
    setInvoiceCustomerId(invoice.customerId);
    setInvoiceNumber(invoice.invoiceNumber);
    setReference(invoice.reference ?? "");
    setDescription(invoice.description ?? "");
    setInvoiceDate(invoice.invoiceDate);
    setDueDate(invoice.dueDate);
    setTaxRate((Number(invoice.taxRateBps) / 100).toFixed(2).replace(/\.?0+$/, ""));
    setLines(invoiceLines.map((line) => ({
      description: line.description,
      quantity: (Number(line.quantityMilli) / 1000).toFixed(3).replace(/\.?0+$/, ""),
      rate: minorInput(line.unitPriceMinor),
    })));
    document.getElementById("new-invoice-form")?.scrollIntoView({ behavior: "smooth" });
  };

  const issueInvoice = async (id) => {
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/sales/invoices/${encodeURIComponent(id)}/issue`, { method: "POST", body: { companyId } });
      await load();
      setSelectedId(id);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Could not issue invoice.");
    } finally {
      setSaving(false);
    }
  };

  const voidInvoice = async (id) => {
    const reason = window.prompt("Enter a reason for voiding this invoice:");
    if (!reason?.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/sales/invoices/${encodeURIComponent(id)}/void`, {
        method: "POST",
        body: { companyId, reason: reason.trim() },
      });
      await load();
      setSelectedId(id);
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "Could not void invoice.");
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    const amountMinor = parseMinor(paymentForm.amount);
    const allocations = Object.entries(paymentForm.allocations)
      .filter(([, amount]) => amount !== "")
      .map(([invoiceId, amount]) => ({ invoiceId, amountMinor: Number(parseMinor(amount)) }));
    if (amountMinor === null || amountMinor <= 0n || allocations.some((allocation) => !allocation.amountMinor)) {
      setError("Enter valid payment and allocation amounts to two decimal places.");
      return;
    }
    const token = paymentIdempotencyKey || globalThis.crypto?.randomUUID?.();
    if (!token) {
      setError("This browser cannot create a safe payment retry key.");
      return;
    }
    if (!paymentIdempotencyKey) setPaymentIdempotencyKey(token);
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/sales/payments", {
        method: "POST",
        body: {
          companyId,
          customerId: paymentForm.customerId,
          paymentDate: paymentForm.paymentDate,
          currency: "PHP",
          amountMinor: Number(amountMinor),
          reference: paymentForm.reference.trim() || null,
          allocations,
          creditOnAccount: paymentForm.creditOnAccount,
        },
        headers: { "Idempotency-Key": token },
      });
      setShowPaymentForm(false);
      setPaymentForm({ customerId: "", paymentDate: today(), amount: "", reference: "", allocations: {}, creditOnAccount: false });
      setPaymentIdempotencyKey("");
      await load();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Could not record payment.");
    } finally {
      setSaving(false);
    }
  };

  const createCreditNote = async (invoice) => {
    const amount = window.prompt("Credit note amount in PHP (for example 100.00):");
    if (amount === null) return;
    const reason = window.prompt("Reason for this credit note:");
    if (!reason?.trim()) return;
    const amountMinor = parseMinor(amount);
    if (amountMinor === null || amountMinor <= 0n) {
      setError("Enter a valid credit note amount to two decimal places.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/sales/invoices/${encodeURIComponent(invoice.id)}/credit-notes`, {
        method: "POST",
        body: { companyId, creditDate: today(), amountMinor: Number(amountMinor), reason: reason.trim() },
      });
      await load();
      setSelectedId(invoice.id);
    } catch (creditError) {
      setError(creditError instanceof Error ? creditError.message : "Could not create credit note.");
    } finally {
      setSaving(false);
    }
  };

  const filteredInvoices = filterStatus === "all" ? invoices : invoices.filter((invoice) => invoice.status === filterStatus);
  const issuedInvoices = invoices.filter((invoice) => invoice.customerId === paymentForm.customerId && ["sent", "partially paid", "overdue"].includes(invoice.status));

  if (!companyId) {
    return <section className="rounded-xl border bg-background p-6"><h1 className="text-2xl font-semibold">Sales &amp; Receivables</h1><p className="mt-2 text-sm text-muted-foreground">Select a company to manage customers and invoices.</p></section>;
  }
  if (isCheckingAccess) {
    return <section className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">Checking Sales &amp; Receivables access…</section>;
  }
  if (!canView) {
    return <section className="rounded-xl border bg-background p-6"><h1 className="text-xl font-semibold">Sales &amp; Receivables</h1><p className="mt-2 text-sm text-destructive">{permissionError ? `Could not verify sales access: ${permissionError}` : "You do not have permission to view sales records for this company."}</p></section>;
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales &amp; Receivables</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage customer invoices, payments, and accounts receivable.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => document.getElementById("new-invoice-form")?.scrollIntoView({ behavior: "smooth" })}>+ New invoice</Button>
          <Button type="button" variant="outline" onClick={() => setShowCustomerForm((open) => !open)}>Customers</Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total receivables", summary ? money(summary.receivablesMinor) : "—", "Outstanding issued invoices"],
          ["Overdue", summary ? money(summary.overdueMinor) : "—", "Past due date"],
          ["Paid (this month)", summary ? money(summary.paidThisMonthMinor) : "—", "Customer payments received"],
          ["Draft invoices", summary ? String(summary.draftCount) : "—", "Not yet issued"],
        ].map(([label, amount, helper], index) => (
          <article key={label} className="rounded-xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${index === 1 && summary?.overdueMinor > 0 ? "text-red-700" : index === 2 ? "text-green-700" : ""}`}>{loading ? "—" : amount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
          </article>
        ))}
      </div>

      {showCustomerForm && (
        <form onSubmit={saveCustomer} className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="sm:col-span-2 xl:col-span-3"><h2 className="font-medium">New customer</h2></div>
          <label className="grid gap-1 text-xs font-medium">Customer name<Input required value={customerForm.name} onChange={(event) => setCustomerForm((form) => ({ ...form, name: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-medium">Email<Input type="email" value={customerForm.email} onChange={(event) => setCustomerForm((form) => ({ ...form, email: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-medium">Phone<Input value={customerForm.phone} onChange={(event) => setCustomerForm((form) => ({ ...form, phone: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-medium">Billing address<Input value={customerForm.billingAddress} onChange={(event) => setCustomerForm((form) => ({ ...form, billingAddress: event.target.value }))} /></label>
          <div className="flex items-end gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save customer"}</Button><Button type="button" variant="outline" onClick={() => setShowCustomerForm(false)}>Cancel</Button></div>
        </form>
      )}

      <form id="new-invoice-form" onSubmit={(event) => saveInvoice(event, true)} className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-medium">{editingInvoiceId ? "Edit draft invoice" : "New invoice"}</h2><p className="text-sm text-muted-foreground">Enter amounts in Philippine pesos with two decimal places.</p></div>
          <p className="text-xs text-muted-foreground">Tax settings [VERIFY] — confirm with a licensed Philippine CPA or tax counsel.</p>
        </div>
        {customers.length === 0 && !loading && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Create a customer before creating an invoice.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-xs font-medium">Customer<select required className="h-8 rounded-md border bg-background px-2 text-sm" value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}><option value="">Select customer</option>{customers.filter((customer) => customer.isActive).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.id.startsWith("demo-customer-") ? " (demo)" : ""}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium">Invoice date<Input type="date" required value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium">Due date<Input type="date" required value={dueDate} min={invoiceDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium">Invoice #<Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Generated if blank" /></label>
          <label className="grid gap-1 text-xs font-medium">Reference<Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" /></label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">Description<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional invoice memo" /></label>
          <label className="grid gap-1 text-xs font-medium">Tax rate [VERIFY] (%)<Input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Item / Account</TableHead><TableHead>Description</TableHead><TableHead>Qty</TableHead><TableHead>Rate</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{lines.map((line, index) => {
              const amount = lineAmount(line);
              return <TableRow key={index}>
                <TableCell className="min-w-44"><Input value="4000 — Service Revenue" readOnly aria-label="Revenue account" /></TableCell>
                <TableCell className="min-w-48"><Input value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Service or item" /></TableCell>
                <TableCell className="min-w-24"><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></TableCell>
                <TableCell className="min-w-32"><Input type="text" inputMode="decimal" value={line.rate} onChange={(event) => updateLine(index, "rate", event.target.value)} placeholder="0.00" aria-invalid={parseMinor(line.rate) === null} /></TableCell>
                <TableCell className="text-right tabular-nums">{amount === null ? "—" : money(amount)}</TableCell>
                <TableCell><Button type="button" size="icon-xs" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>×</Button></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          <div className="grid min-w-56 gap-1 text-right text-sm">
            <div className="flex justify-between gap-6"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
            <div className="flex justify-between gap-6"><span className="text-muted-foreground">Tax [VERIFY]</span><span className="tabular-nums">{money(tax)}</span></div>
            <div className="flex justify-between gap-6 border-t pt-1 font-semibold text-green-700"><span>Total due</span><span className="tabular-nums">{money(total)}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" disabled={!canSaveInvoice || saving} onClick={saveInvoice}>{saving ? "Saving…" : "Save draft"}</Button>
          <Button type="submit" disabled={!canSaveInvoice || saving}>{saving ? "Saving…" : "Issue invoice"}</Button>
          {editingInvoiceId && <Button type="button" variant="outline" onClick={clearInvoiceForm}>Cancel edit</Button>}
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-medium">Invoices</h2>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant={section === "invoices" ? "default" : "outline"} onClick={() => setSection("invoices")}>Invoices</Button>
              <Button size="sm" variant={section === "aging" ? "default" : "outline"} onClick={() => setSection("aging")}>Aging</Button>
              <Button size="sm" variant={section === "payments" ? "default" : "outline"} onClick={() => setSection("payments")}>Payments</Button>
              <Button size="sm" variant="outline" onClick={() => setShowPaymentForm((show) => !show)}>Record payment</Button>
            </div>
          </div>
          {section === "invoices" && <select aria-label="Invoice status filter" className="h-8 rounded-md border bg-background px-2 text-sm" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : status[0].toUpperCase() + status.slice(1)}</option>)}</select>}
        </div>
        {showPaymentForm && (
          <form onSubmit={recordPayment} className="grid gap-3 border-b bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2 xl:col-span-4"><h3 className="font-medium">Record customer payment</h3><p className="text-xs text-muted-foreground">Payment postings are immutable; corrections require a reversal.</p></div>
            <label className="grid gap-1 text-xs font-medium">Customer<select required className="h-8 rounded-md border bg-background px-2 text-sm" value={paymentForm.customerId} onChange={(event) => setPaymentForm((form) => ({ ...form, customerId: event.target.value, allocations: {} }))}><option value="">Select customer</option>{customers.filter((customer) => customer.isActive).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-medium">Payment date<Input type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm((form) => ({ ...form, paymentDate: event.target.value }))} required /></label>
            <label className="grid gap-1 text-xs font-medium">Amount (PHP)<Input inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm((form) => ({ ...form, amount: event.target.value }))} required placeholder="0.00" /></label>
            <label className="grid gap-1 text-xs font-medium">Reference<Input value={paymentForm.reference} onChange={(event) => setPaymentForm((form) => ({ ...form, reference: event.target.value }))} /></label>
            {issuedInvoices.map((invoice) => <label key={invoice.id} className="grid gap-1 text-xs font-medium">{invoice.invoiceNumber} — balance {money(invoice.remainingMinor)}<Input inputMode="decimal" placeholder="Allocation amount" value={paymentForm.allocations[invoice.id] ?? ""} onChange={(event) => setPaymentForm((form) => ({ ...form, allocations: { ...form.allocations, [invoice.id]: event.target.value } }))} /></label>)}
            {paymentForm.customerId && issuedInvoices.length === 0 && <p className="text-sm text-muted-foreground">No issued invoice balances for this customer.</p>}
            <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={paymentForm.creditOnAccount} onChange={(event) => setPaymentForm((form) => ({ ...form, creditOnAccount: event.target.checked }))} />Record any unapplied amount as customer credit on account</label>
            <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "Recording…" : "Record payment"}</Button><Button type="button" variant="outline" onClick={() => setShowPaymentForm(false)}>Cancel</Button></div>
          </form>
        )}
        {loading ? <p className="p-6 text-sm text-muted-foreground">Loading sales records…</p> : section === "payments" ? (
          payments.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No customer payments recorded yet.</p> : (
            <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Reference / Voucher</TableHead><TableHead className="text-right">Allocated</TableHead><TableHead className="text-right">Credit on account</TableHead><TableHead className="text-right">Payment</TableHead></TableRow></TableHeader>
              <TableBody>{payments.map((payment) => <TableRow key={payment.id}><TableCell>{payment.paymentDate}</TableCell><TableCell>{payment.customerName}</TableCell><TableCell>{payment.reference || payment.voucherNumber}</TableCell><TableCell className="text-right tabular-nums">{money(payment.allocatedMinor)}</TableCell><TableCell className="text-right tabular-nums">{money(payment.creditMinor)}</TableCell><TableCell className="text-right tabular-nums">{money(payment.amountMinor)}</TableCell></TableRow>)}</TableBody>
            </Table>
          )
        ) : section === "aging" ? (
          !aging?.data?.length ? <p className="p-6 text-sm text-muted-foreground">No outstanding invoices to age.</p> : (
            <Table><TableHeader><TableRow><TableHead>Customer / Invoice</TableHead><TableHead>Due date</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>{aging.data.map((invoice) => <TableRow key={invoice.id}><TableCell><button type="button" className="text-left hover:underline" onClick={() => setSelectedId(invoice.id)}>{invoice.customerName} · {invoice.invoiceNumber}</button></TableCell><TableCell>{invoice.dueDate}</TableCell><TableCell>{invoice.bucket === "current" ? "Current" : `${invoice.bucket} days`}</TableCell><TableCell className="text-right tabular-nums">{money(invoice.remainingMinor)}</TableCell></TableRow>)}</TableBody>
            </Table>
          )
        ) : filteredInvoices.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No invoices yet.</p> : (
          <Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount due</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>{filteredInvoices.map((invoice) => <TableRow key={invoice.id}>
              <TableCell><button type="button" className="font-medium hover:underline" onClick={() => setSelectedId(invoice.id)}>{invoice.invoiceNumber}</button></TableCell>
              <TableCell>{invoice.customerName}{invoice.customerId.startsWith("demo-customer-") ? " (demo)" : ""}</TableCell>
              <TableCell>{invoice.invoiceDate}</TableCell><TableCell>{invoice.dueDate}</TableCell>
              <TableCell><StatusBadge status={invoice.status} /></TableCell>
              <TableCell className="text-right tabular-nums">{money(invoice.remainingMinor)}</TableCell>
              <TableCell><div className="flex gap-1">{invoice.status === "draft" && <Button size="sm" variant="outline" disabled={saving} onClick={() => issueInvoice(invoice.id)}>Issue</Button>}{invoice.status === "draft" && <Button size="sm" variant="outline" disabled={saving} onClick={() => voidInvoice(invoice.id)}>Void</Button>}{invoice.status !== "draft" && invoice.status !== "void" && <Button size="sm" variant="outline" onClick={() => setSelectedId(invoice.id)}>View</Button>}</div></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        )}
      </section>

      {detail?.invoice && detail.invoice.id === selectedId && (
        <section className="space-y-3 rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-medium">Invoice detail · {detail.invoice.invoiceNumber}</h2><p className="text-sm text-muted-foreground">{detail.invoice.customerName} · <StatusBadge status={detail.invoice.status} /></p></div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => printInvoice(detail.invoice, detail.lines)}>Print / PDF</Button>
              {detail.invoice.status === "draft" && <Button type="button" variant="outline" onClick={() => { editDraft(detail.invoice, detail.lines); setSelectedId(""); }}>Edit draft</Button>}
              {detail.invoice.status === "draft" && <Button type="button" variant="outline" onClick={() => voidInvoice(detail.invoice.id)}>Void draft</Button>}
              {["sent", "partially paid", "overdue"].includes(detail.invoice.status) && <Button type="button" variant="outline" onClick={() => createCreditNote(detail.invoice)}>Credit note</Button>}
              <Button type="button" variant="outline" onClick={() => setSelectedId("")}>Close</Button>
            </div>
          </div>
          <Table><TableHeader><TableRow><TableHead>Item / Account</TableHead><TableHead>Description</TableHead><TableHead>Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{detail.lines.map((line) => <TableRow key={line.id}><TableCell>4000 — Service Revenue</TableCell><TableCell>{line.description}</TableCell><TableCell>{(Number(line.quantityMilli) / 1000).toFixed(3).replace(/\.?0+$/, "")}</TableCell><TableCell className="text-right">{money(line.unitPriceMinor)}</TableCell><TableCell className="text-right">{money(line.amountMinor)}</TableCell></TableRow>)}</TableBody>
          </Table>
          <div className="grid justify-end gap-1 text-right text-sm"><p>Subtotal: {money(detail.invoice.subtotalMinor)}</p><p>Tax [VERIFY]: {money(detail.invoice.taxMinor)}</p><p className="font-semibold">Total: {money(detail.invoice.totalMinor)}</p><p>Paid: {money(detail.invoice.appliedMinor)}</p><p>Credits: {money(detail.invoice.creditMinor)}</p><p className="font-semibold text-green-700">Balance due: {money(detail.invoice.remainingMinor)}</p></div>
          {detail.creditNotes?.length > 0 && <div><h3 className="font-medium">Credit notes</h3><ul className="mt-2 space-y-1 text-sm">{detail.creditNotes.map((note) => <li key={note.id}>{note.creditNumber} · {note.creditDate} · {money(note.amountMinor)} · {note.reason}</li>)}</ul></div>}
          {detail.invoice.status === "draft" && <Button type="button" disabled={saving} onClick={() => issueInvoice(detail.invoice.id)}>{saving ? "Issuing…" : "Issue invoice"}</Button>}
        </section>
      )}
    </section>
  );
}
