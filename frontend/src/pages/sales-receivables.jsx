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
const emptyTemplate = () => ({
  title: "INVOICE",
  accentColor: "#111827",
  layout: "clean",
  logoSize: "medium",
  logoAlignment: "left",
  visibility: { logo: true, customerEmail: true, reference: true, discount: true, tax: true, paymentNotes: true, preparedBy: false },
  paymentInstructions: "",
  terms: "",
  preparedBy: "",
});

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

function profileForCompany(company) {
  const rawLogo = company?.company_logo ?? "";
  const logo = /^data:image\/(?:png|jpeg|webp);base64,/.test(rawLogo) || /^https:\/\//i.test(rawLogo)
    ? rawLogo
    : "";
  return {
    name: company?.name ?? "",
    legalName: company?.legal_name ?? "",
    address: company?.address ?? "",
    email: company?.email ?? "",
    phone: company?.contact_number ?? "",
    logo,
  };
}

function issuerProfilePayload(profile) {
  return {
    name: profile.name.trim(),
    legalName: profile.legalName.trim() || null,
    address: profile.address.trim() || null,
    email: profile.email.trim() || null,
    phone: profile.phone.trim() || null,
    logo: profile.logo,
  };
}

function readLogoFile(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return Promise.reject(new Error("Choose a PNG, JPEG, or WebP logo."));
  }
  if (file.size > 400 * 1024) {
    return Promise.reject(new Error("Logo must be 400 KB or smaller."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the logo file."));
    reader.readAsDataURL(file);
  });
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

function printInvoice(invoice, lines, issuerProfile = {}, template = emptyTemplate()) {
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow pop-ups to print this invoice.");
  preview.opener = null;
  const doc = preview.document;
  doc.title = `Invoice ${invoice.invoiceNumber}`;
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(template.accentColor ?? "")
    ? template.accentColor
    : "#111827";
  const visibility = { ...emptyTemplate().visibility, ...template.visibility };
  const style = doc.createElement("style");
  style.textContent = `body{font:14px Arial,sans-serif;margin:40px auto;max-width:850px;color:#172033}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${accentColor};padding-bottom:24px}.brand{display:flex;gap:16px;align-items:center}.brand.right{flex-direction:row-reverse}.logo,.logo-fallback{object-fit:contain;border-radius:12px}.logo.small,.logo-fallback.small{width:48px;height:48px}.logo.medium,.logo-fallback.medium{width:76px;height:76px}.logo.large,.logo-fallback.large{width:100px;height:100px}.logo-fallback{display:grid;place-items:center;background:${accentColor};color:white;font-size:24px;font-weight:bold}.brand h1{font-size:22px;margin:0 0 6px}.muted{color:#64748b;font-size:12px;line-height:1.6}.title{text-align:right}.title h2{font-size:30px;letter-spacing:.08em;margin:0 0 8px;color:${accentColor}}.meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:28px 0}.meta h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}.meta p{margin:4px 0;line-height:1.5}.items{width:100%;border-collapse:collapse;margin-top:28px}.items th{font-size:11px;text-transform:uppercase;color:#64748b;background:#f8fafc}.items th,.items td{border-bottom:1px solid #e2e8f0;padding:12px 10px;text-align:left}.items td:last-child,.items th:last-child{text-align:right}.totals{margin:24px 0 0 auto;width:min(100%,320px)}.total-row{display:flex;justify-content:space-between;padding:7px 0}.grand{border-top:1px solid #cbd5e1;margin-top:6px;padding-top:12px;font-size:18px;font-weight:bold;color:${accentColor}}.footer{border-top:1px solid #e2e8f0;margin-top:36px;padding-top:12px}.compact .meta{margin:16px 0}.compact .items{margin-top:16px}.compact .items th,.compact .items td{padding:7px}@media print{body{margin:0 auto;padding:24px}}`;
  doc.head.append(style);
  const body = doc.body;
  body.className = template.layout === "compact" ? "compact" : "";
  const top = doc.createElement("header");
  top.className = "top";
  const brand = doc.createElement("div");
  brand.className = `brand ${template.logoAlignment === "right" ? "right" : ""}`;
  if (visibility.logo && issuerProfile.logo) {
    const logo = doc.createElement("img");
    logo.className = `logo ${template.logoSize || "medium"}`;
    logo.src = issuerProfile.logo;
    logo.alt = `${issuerProfile.name || "Business"} logo`;
    brand.append(logo);
  } else if (visibility.logo) {
    const fallback = doc.createElement("div");
    fallback.className = `logo-fallback ${template.logoSize || "medium"}`;
    fallback.textContent = (issuerProfile.name || "Business").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
    brand.append(fallback);
  }
  const seller = doc.createElement("div");
  const sellerName = doc.createElement("h1");
  sellerName.textContent = issuerProfile.legalName || issuerProfile.name || "Your business";
  seller.append(sellerName);
  const sellerDetails = [issuerProfile.address, issuerProfile.email, issuerProfile.phone].filter(Boolean);
  for (const value of sellerDetails) {
    const line = doc.createElement("div");
    line.className = "muted";
    line.textContent = value;
    seller.append(line);
  }
  brand.append(seller);
  const title = doc.createElement("div");
  title.className = "title";
  const heading = doc.createElement("h2");
  heading.textContent = template.title || "INVOICE";
  const number = doc.createElement("strong");
  number.textContent = invoice.invoiceNumber || "Draft";
  title.append(heading, number);
  top.append(brand, title);
  body.append(top);
  const meta = doc.createElement("div");
  meta.className = "meta";
  const billTo = doc.createElement("section");
  const billToHeading = doc.createElement("h3");
  billToHeading.textContent = "Bill to";
  billTo.append(billToHeading);
  for (const value of [
    invoice.customerName,
    invoice.customerBillingAddress,
    visibility.customerEmail ? invoice.customerEmail : "",
    invoice.customerPhone,
  ].filter(Boolean)) {
    const line = doc.createElement("p");
    line.textContent = value;
    billTo.append(line);
  }
  const invoiceInfo = doc.createElement("section");
  const infoHeading = doc.createElement("h3");
  infoHeading.textContent = "Invoice details";
  invoiceInfo.append(infoHeading);
  for (const [label, value] of [
    ["Invoice date", invoice.invoiceDate],
    ["Due date", invoice.dueDate],
    ...(visibility.reference ? [["Reference", invoice.reference || "—"]] : []),
  ]) {
    const line = doc.createElement("p");
    line.textContent = `${label}: ${value}`;
    invoiceInfo.append(line);
  }
  meta.append(billTo, invoiceInfo);
  body.append(meta);
  const table = doc.createElement("table");
  table.className = "items";
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
  const totals = doc.createElement("div");
  const rows = [
    ["Subtotal", invoice.grossSubtotalMinor ?? invoice.subtotalMinor, false],
    ...(visibility.discount && Number(invoice.discountMinor ?? 0) > 0 ? [["Discount", -Number(invoice.discountMinor), false]] : []),
    ...(invoice.taxInclusive ? [["Taxable subtotal", invoice.subtotalMinor, false]] : []),
    ...(visibility.tax ? [["Tax [VERIFY]", invoice.taxMinor, false]] : []),
    ["Total due", invoice.totalMinor, true],
  ];
  for (const [label, amount, bold] of rows) {
    const total = doc.createElement(bold ? "h2" : "p");
    total.className = "total-row";
    if (bold) total.classList.add("grand");
    total.textContent = `${label}: ${amount < 0 ? `-${money(-amount)}` : money(amount)}`;
    totals.append(total);
  }
  totals.className = "totals";
  body.append(totals);
  if (invoice.description) {
    const note = doc.createElement("p");
    note.className = "muted";
    note.textContent = invoice.description;
    body.append(note);
  }
  if (visibility.paymentNotes && (template.paymentInstructions || template.terms)) {
    for (const [label, value] of [["Payment instructions", template.paymentInstructions], ["Terms", template.terms]]) {
      if (!value) continue;
      const note = doc.createElement("p");
      note.className = "muted";
      note.textContent = `${label}: ${value}`;
      body.append(note);
    }
  }
  if (visibility.preparedBy && template.preparedBy) {
    const prepared = doc.createElement("p");
    prepared.className = "muted footer";
    prepared.textContent = `Prepared by: ${template.preparedBy}`;
    body.append(prepared);
  }
  const verify = doc.createElement("p");
  verify.className = "muted footer";
  verify.textContent = "Tax treatment and invoice format [VERIFY] — review with a licensed Philippine CPA or tax counsel.";
  body.append(verify);
  preview.focus();
  preview.print();
}

export default function SalesReceivablesPage({
  companyId,
  company,
  canCreate = false,
  canIssue = false,
  canRecordPayment = false,
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
  const [discountType, setDiscountType] = useState(null);
  const [discountValue, setDiscountValue] = useState("0");
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [applyToAllCustomers, setApplyToAllCustomers] = useState(false);
  const [manualBatchMode, setManualBatchMode] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [previewCustomerId, setPreviewCustomerId] = useState("");
  const [batchRequest, setBatchRequest] = useState(null);
  const [invoiceTemplate, setInvoiceTemplate] = useState(emptyTemplate);
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [invoiceDraftId, setInvoiceDraftId] = useState("");
  const [editingInvoiceId, setEditingInvoiceId] = useState("");
  const companyProfileKey = `${companyId}:${company?.updated_at ?? "loading"}`;
  const [issuerProfileState, setIssuerProfileState] = useState(() => ({
    key: companyProfileKey,
    values: profileForCompany(company),
  }));
  const issuerProfile = issuerProfileState.key === companyProfileKey
    ? issuerProfileState.values
    : profileForCompany(company);
  const setIssuerProfile = (update) => {
    setIssuerProfileState((current) => {
      const currentProfile = current.key === companyProfileKey
        ? current.values
        : profileForCompany(company);
      return {
        key: companyProfileKey,
        values: typeof update === "function" ? update(currentProfile) : update,
      };
    });
  };
  const [savingTemplate, setSavingTemplate] = useState(false);
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + (lineAmount(line) ?? 0n), 0n), [lines]);
  const taxRateBps = /^\d{1,3}(?:\.\d{0,2})?$/.test(taxRate) && Number(taxRate) <= 100
    ? Math.round(Number(taxRate) * 100)
    : null;
  const discountRateBps = /^\d{1,3}(?:\.\d{0,2})?$/.test(discountValue) && Number(discountValue) <= 100
    ? Math.round(Number(discountValue) * 100)
    : null;
  const fixedDiscountMinor = discountType === "fixed" ? parseMinor(discountValue) : 0n;
  const discountMinor = discountType === "percent" && discountRateBps !== null
    ? (subtotal * BigInt(discountRateBps) + 5000n) / 10000n
    : fixedDiscountMinor;
  const discountValid = discountType === null || (discountType === "fixed" ? fixedDiscountMinor !== null : discountRateBps !== null);
  const discountedGross = discountValid && discountMinor !== null && discountMinor <= subtotal ? subtotal - discountMinor : 0n;
  const taxableSubtotal = taxInclusive && taxRateBps !== null
    ? (discountedGross * 10000n + BigInt(10000 + taxRateBps) / 2n) / BigInt(10000 + taxRateBps)
    : discountedGross;
  const tax = taxRateBps === null ? 0n : taxAmount(taxableSubtotal, taxRateBps);
  const inclusiveRoundingValid = !taxInclusive || taxableSubtotal + tax === discountedGross;
  const total = taxableSubtotal + tax;
  const validLines = lines.every((line) => line.description.trim() && parseQuantityMilli(line.quantity) !== null && lineAmount(line) !== null);
  const activeCustomers = customers.filter((customer) => customer.isActive);
  const batchCustomers = applyToAllCustomers
    ? activeCustomers
    : manualBatchMode ? activeCustomers.filter((customer) => selectedCustomerIds.includes(customer.id)) : [];
  const isBatch = applyToAllCustomers || manualBatchMode;
  const activePreviewCustomerId = batchCustomers.some((customer) => customer.id === previewCustomerId)
    ? previewCustomerId
    : batchCustomers[0]?.id;
  const previewCustomer = isBatch
    ? customers.find((customer) => customer.id === activePreviewCustomerId)
    : customers.find((customer) => customer.id === invoiceCustomerId);
  const canSaveInvoice = Boolean(companyId && (isBatch ? batchCustomers.length > 0 && batchCustomers.length <= 20 : invoiceCustomerId) &&
    validLines && subtotal > 0n && discountValid && discountMinor !== null && discountMinor <= subtotal &&
    taxableSubtotal > 0n && taxRateBps !== null && inclusiveRoundingValid && dueDate >= invoiceDate);

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
    if (!companyId || !canView || isCheckingAccess) return undefined;
    const query = new URLSearchParams({ companyId });
    apiRequest(`/api/sales/invoice-template?${query}`)
      .then((result) => {
        if (!active || !result?.data) return;
        const key = `${companyId}:${company?.updated_at ?? "loading"}`;
        const savedProfile = result.data.issuerProfile;
        setIssuerProfileState({
          key,
          values: {
            name: savedProfile.name ?? company?.name ?? "",
            legalName: savedProfile.legalName ?? company?.legal_name ?? "",
            address: savedProfile.address ?? company?.address ?? "",
            email: savedProfile.email ?? company?.email ?? "",
            phone: savedProfile.phone ?? company?.contact_number ?? "",
            logo: savedProfile.logo ?? profileForCompany(company).logo,
          },
        });
        setInvoiceTemplate({ ...emptyTemplate(), ...result.data.template, visibility: { ...emptyTemplate().visibility, ...result.data.template.visibility } });
      })
      .catch((templateError) => {
        if (!active) return;
        const message = templateError instanceof Error ? templateError.message : "";
        setError(message.includes("404")
          ? "The deployed accounting API is missing the invoice-template endpoint. Apply migration 0014 and deploy the Worker, then reload this page."
          : message || "Could not load invoice template.");
      });
    return () => { active = false; };
  }, [canView, company, companyId, company?.updated_at, isCheckingAccess]);

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

  const saveInvoiceTemplate = async () => {
    if (!canCreate || !companyId) return;
    setSavingTemplate(true);
    setError("");
    try {
      const saved = await apiRequest("/api/sales/invoice-template", {
        method: "PUT",
        body: { companyId, issuerProfile: issuerProfilePayload(issuerProfile), template: invoiceTemplate },
      });
      if (saved?.data?.template) setInvoiceTemplate(saved.data.template);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save invoice template.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const previewCurrentInvoice = () => {
    const customer = previewCustomer;
    const previewLines = lines.map((line) => ({
      description: line.description,
      quantityMilli: parseQuantityMilli(line.quantity) ?? 0,
      unitPriceMinor: Number(parseMinor(line.rate) ?? 0n),
      amountMinor: Number(lineAmount(line) ?? 0n),
    }));
    try {
      printInvoice({
        invoiceNumber: invoiceNumber.trim() || "DRAFT",
        customerName: customer?.name || "Customer",
        customerBillingAddress: customer?.billingAddress,
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        invoiceDate,
        dueDate,
        reference: reference.trim(),
        description: description.trim(),
        grossSubtotalMinor: Number(subtotal),
        subtotalMinor: Number(taxableSubtotal),
        discountMinor: Number(discountMinor ?? 0n),
        taxInclusive,
        taxMinor: Number(tax),
        totalMinor: Number(total),
      }, previewLines, issuerProfile, invoiceTemplate);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not open invoice preview.");
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
    setDiscountType(null);
    setDiscountValue("0");
    setTaxInclusive(false);
    setApplyToAllCustomers(false);
    setManualBatchMode(false);
    setSelectedCustomerIds([]);
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
      if (isBatch) {
        const batchPayload = {
          companyId,
          customerIds: applyToAllCustomers ? [] : batchCustomers.map((customer) => customer.id),
          applyToAllActive: applyToAllCustomers,
          issue: issueAfterSave,
          invoiceDate,
          dueDate,
          currency: "PHP",
          reference: reference.trim() || null,
          description: description.trim() || null,
          issuerProfile: issuerProfilePayload(issuerProfile),
          template: invoiceTemplate,
          discountType,
          discountValue: discountType === "percent" ? discountRateBps : Number(fixedDiscountMinor ?? 0n),
          taxInclusive,
          taxRateBps,
          lines: lines.map((line) => ({
            description: line.description.trim(),
            quantityMilli: parseQuantityMilli(line.quantity),
            unitPriceMinor: Number(parseMinor(line.rate)),
          })),
        };
        const fingerprint = JSON.stringify(batchPayload);
        const key = batchRequest?.fingerprint === fingerprint
          ? batchRequest.key
          : globalThis.crypto?.randomUUID?.();
        if (!key) throw new Error("This browser cannot create a safe batch retry key.");
        if (batchRequest?.key !== key) setBatchRequest({ key, fingerprint });
        const batchResult = await apiRequest("/api/sales/invoices/batch", {
          method: "POST",
          body: batchPayload,
          headers: { "Idempotency-Key": key },
        });
        setBatchRequest(null);
        const firstInvoice = batchResult?.data?.invoices?.[0];
        clearInvoiceForm();
        await load();
        if (firstInvoice?.id) setSelectedId(firstInvoice.id);
        return;
      }
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
        issuerProfile: issuerProfilePayload(issuerProfile),
        template: invoiceTemplate,
        discountType,
        discountValue: discountType === "percent" ? discountRateBps : Number(fixedDiscountMinor ?? 0n),
        taxInclusive,
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
    const savedProfile = invoice.issuerProfile;
    setIssuerProfile({
      name: savedProfile?.name ?? company?.name ?? "",
      legalName: savedProfile?.legalName ?? company?.legal_name ?? "",
      address: savedProfile?.address ?? company?.address ?? "",
      email: savedProfile?.email ?? company?.email ?? "",
      phone: savedProfile?.phone ?? company?.contact_number ?? "",
      logo: savedProfile?.logo ?? profileForCompany(company).logo,
    });
    setInvoiceTemplate({ ...emptyTemplate(), ...invoice.template, visibility: { ...emptyTemplate().visibility, ...invoice.template?.visibility } });
    setInvoiceDate(invoice.invoiceDate);
    setDueDate(invoice.dueDate);
    setTaxRate((Number(invoice.taxRateBps) / 100).toFixed(2).replace(/\.?0+$/, ""));
    setDiscountType(invoice.discountType ?? null);
    setDiscountValue(invoice.discountType === "percent"
      ? (Number(invoice.discountValue) / 100).toFixed(2).replace(/\.?0+$/, "")
      : minorInput(invoice.discountValue ?? 0));
    setTaxInclusive(Boolean(invoice.taxInclusive));
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
          {canCreate && <Button type="button" onClick={() => document.getElementById("new-invoice-form")?.scrollIntoView({ behavior: "smooth" })}>+ New invoice</Button>}
          {canCreate && <Button type="button" variant="outline" onClick={() => setShowCustomerForm((open) => !open)}>Customers</Button>}
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

      {canCreate && showCustomerForm && (
        <form onSubmit={saveCustomer} className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="sm:col-span-2 xl:col-span-3"><h2 className="font-medium">New customer</h2></div>
          <label className="grid gap-1 text-xs font-medium">Customer name<Input required value={customerForm.name} onChange={(event) => setCustomerForm((form) => ({ ...form, name: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-medium">Email<Input type="email" value={customerForm.email} onChange={(event) => setCustomerForm((form) => ({ ...form, email: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-medium">Phone<Input value={customerForm.phone} onChange={(event) => setCustomerForm((form) => ({ ...form, phone: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-medium">Billing address<Input value={customerForm.billingAddress} onChange={(event) => setCustomerForm((form) => ({ ...form, billingAddress: event.target.value }))} /></label>
          <div className="flex items-end gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save customer"}</Button><Button type="button" variant="outline" onClick={() => setShowCustomerForm(false)}>Cancel</Button></div>
        </form>
      )}

      {canCreate && <form id="new-invoice-form" onSubmit={(event) => saveInvoice(event, canIssue)} className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-medium">{editingInvoiceId ? "Edit draft invoice" : "New invoice"}</h2><p className="text-sm text-muted-foreground">Enter amounts in Philippine pesos with two decimal places.</p></div>
          <p className="text-xs text-muted-foreground">Tax settings [VERIFY] — confirm with a licensed Philippine CPA or tax counsel.</p>
        </div>
        {customers.length === 0 && !loading && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Create a customer before creating an invoice.</p>}
        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Invoice branding &amp; seller details</h3>
              <p className="mt-1 text-xs text-muted-foreground">These details are saved on each invoice so issued documents keep their original appearance.</p>
            </div>
            {canCreate && <Button type="button" size="sm" variant="outline" disabled={savingTemplate || !issuerProfile.name.trim()} onClick={saveInvoiceTemplate}>{savingTemplate ? "Saving…" : "Save as template default"}</Button>}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium">Business / display name<Input required maxLength={160} value={issuerProfile.name} onChange={(event) => setIssuerProfile((profile) => ({ ...profile, name: event.target.value }))} placeholder="Your business name" /></label>
              <label className="grid gap-1 text-xs font-medium">Legal name<Input maxLength={160} value={issuerProfile.legalName} onChange={(event) => setIssuerProfile((profile) => ({ ...profile, legalName: event.target.value }))} placeholder="Optional registered name" /></label>
              <label className="grid gap-1 text-xs font-medium sm:col-span-2">Business address<Input maxLength={1000} value={issuerProfile.address} onChange={(event) => setIssuerProfile((profile) => ({ ...profile, address: event.target.value }))} placeholder="Street, city, region, postal code" /></label>
              <label className="grid gap-1 text-xs font-medium">Business email<Input type="email" maxLength={254} value={issuerProfile.email} onChange={(event) => setIssuerProfile((profile) => ({ ...profile, email: event.target.value }))} placeholder="billing@example.com" /></label>
              <label className="grid gap-1 text-xs font-medium">Phone<Input maxLength={64} value={issuerProfile.phone} onChange={(event) => setIssuerProfile((profile) => ({ ...profile, phone: event.target.value }))} placeholder="+63 ..." /></label>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Business logo</span>
              <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-background p-3">
                {issuerProfile.logo ? <img src={issuerProfile.logo} alt="Invoice logo preview" className="max-h-24 max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">Logo preview</span>}
              </div>
              <Input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload business logo" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const logo = await readLogoFile(file);
                  setIssuerProfile((profile) => ({ ...profile, logo }));
                  setError("");
                } catch (logoError) {
                  setError(logoError instanceof Error ? logoError.message : "Could not load logo.");
                }
                event.target.value = "";
              }} />
              {issuerProfile.logo && <Button type="button" size="sm" variant="ghost" onClick={() => setIssuerProfile((profile) => ({ ...profile, logo: "" }))}>Remove logo</Button>}
            </div>
          </div>
          <p className="text-xs text-amber-800">TIN and bank account fields are omitted until encrypted storage is configured. Do not enter sensitive identifiers in payment instructions.</p>
        </section>
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={applyToAllCustomers} onChange={(event) => {
              setApplyToAllCustomers(event.target.checked);
              if (event.target.checked) setManualBatchMode(false);
            }} />Apply to all active customers</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={manualBatchMode} onChange={(event) => {
              setManualBatchMode(event.target.checked);
              if (event.target.checked) setApplyToAllCustomers(false);
            }} />Choose multiple customers</label>
            {isBatch && <span className="text-xs text-muted-foreground">{batchCustomers.length} invoice{batchCustomers.length === 1 ? "" : "s"} will be created · each gets its own customer and invoice number</span>}
          </div>
          {applyToAllCustomers && <p className="text-xs text-muted-foreground">Only active customers in the selected company are included. Batch limit: 20 customers per request.</p>}
          {manualBatchMode && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activeCustomers.map((customer) => <label key={customer.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <input type="checkbox" checked={selectedCustomerIds.includes(customer.id)} onChange={(event) => setSelectedCustomerIds((current) => event.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id))} />
              <span>{customer.name}{customer.id.startsWith("demo-customer-") ? " (demo)" : ""}</span>
            </label>)}
          </div>}
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {!isBatch && <label className="grid gap-1 text-xs font-medium">Customer<select required className="h-8 rounded-md border bg-background px-2 text-sm" value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}><option value="">Select customer</option>{activeCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.id.startsWith("demo-customer-") ? " (demo)" : ""}</option>)}</select></label>}
          <label className="grid gap-1 text-xs font-medium">Invoice date<Input type="date" required value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium">Due date<Input type="date" required value={dueDate} min={invoiceDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          {!isBatch && <label className="grid gap-1 text-xs font-medium">Invoice #<Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Sequential if blank" /></label>}
          <label className="grid gap-1 text-xs font-medium">Reference<Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" /></label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">Description<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional invoice memo" /></label>
          <label className="grid gap-1 text-xs font-medium">Tax rate [VERIFY] (%)<Input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium">Discount type<select className="h-8 rounded-md border bg-background px-2 text-sm" value={discountType ?? "none"} onChange={(event) => setDiscountType(event.target.value === "none" ? null : event.target.value)}><option value="none">No discount</option><option value="fixed">Fixed amount</option><option value="percent">Percentage</option></select></label>
          {discountType && <label className="grid gap-1 text-xs font-medium">Discount {discountType === "percent" ? "(%)" : "(PHP)"}<Input inputMode="decimal" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0.00" aria-invalid={!discountValid} /></label>}
          <label className="grid gap-1 text-xs font-medium"><span className="flex items-center gap-2"><input type="checkbox" checked={taxInclusive} onChange={(event) => setTaxInclusive(event.target.checked)} />Tax-inclusive pricing [VERIFY]</span><span className="font-normal text-muted-foreground">Tax rate applies to every item. Tax-inclusive totals with unrepresentable centavo rounding are rejected.</span></label>
        </div>
        {taxInclusive && !inclusiveRoundingValid && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">This inclusive amount creates a centavo rounding remainder. Adjust the amount or use tax-exclusive pricing; the remainder will not be silently dropped.</p>}
        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div><h3 className="text-sm font-semibold">Template designer</h3><p className="mt-1 text-xs text-muted-foreground">Style and visibility settings are captured with each invoice. Tax labels and invoice-title requirements [VERIFY].</p></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs font-medium">Invoice title [VERIFY]<Input maxLength={40} value={invoiceTemplate.title} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, title: event.target.value }))} /></label>
            <label className="grid gap-1 text-xs font-medium">Accent color<Input type="color" value={invoiceTemplate.accentColor} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, accentColor: event.target.value }))} /></label>
            <label className="grid gap-1 text-xs font-medium">Layout<select className="h-8 rounded-md border bg-background px-2 text-sm" value={invoiceTemplate.layout} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, layout: event.target.value }))}><option value="clean">Clean</option><option value="compact">Compact</option></select></label>
            <label className="grid gap-1 text-xs font-medium">Logo size<select className="h-8 rounded-md border bg-background px-2 text-sm" value={invoiceTemplate.logoSize} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, logoSize: event.target.value }))}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            <label className="grid gap-1 text-xs font-medium">Logo alignment<select className="h-8 rounded-md border bg-background px-2 text-sm" value={invoiceTemplate.logoAlignment} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, logoAlignment: event.target.value }))}><option value="left">Left</option><option value="right">Right</option></select></label>
            <label className="grid gap-1 text-xs font-medium sm:col-span-2">Payment instructions<Input maxLength={1000} value={invoiceTemplate.paymentInstructions} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, paymentInstructions: event.target.value }))} placeholder="Non-sensitive payment instructions only" /></label>
            <label className="grid gap-1 text-xs font-medium sm:col-span-2">Terms / notes<Input maxLength={1000} value={invoiceTemplate.terms} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, terms: event.target.value }))} placeholder="Payment due terms or customer notes" /></label>
            <label className="grid gap-1 text-xs font-medium">Prepared by<Input maxLength={160} value={invoiceTemplate.preparedBy} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, preparedBy: event.target.value }))} /></label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3">
            {Object.entries({ logo: "Logo", customerEmail: "Customer email", reference: "PO / Reference", discount: "Discount", tax: "Tax breakdown", paymentNotes: "Payment / terms notes", preparedBy: "Prepared-by line" }).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={invoiceTemplate.visibility[key]} onChange={(event) => setInvoiceTemplate((template) => ({ ...template, visibility: { ...template.visibility, [key]: event.target.checked } }))} />{label}</label>)}
          </div>
        </section>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Item / Description</TableHead><TableHead>Qty</TableHead><TableHead>Rate (₱)</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Order</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{lines.map((line, index) => {
              const amount = lineAmount(line);
              return <TableRow key={index}>
                <TableCell className="min-w-60"><Input value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Item name and description" /></TableCell>
                <TableCell className="min-w-24"><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></TableCell>
                <TableCell className="min-w-32"><Input type="text" inputMode="decimal" value={line.rate} onChange={(event) => updateLine(index, "rate", event.target.value)} placeholder="0.00" aria-invalid={parseMinor(line.rate) === null} /></TableCell>
                <TableCell className="text-right tabular-nums">{amount === null ? "—" : money(amount)}</TableCell>
                <TableCell><div className="flex"><Button type="button" size="icon-xs" variant="ghost" aria-label="Move item up" disabled={index === 0} onClick={() => setLines((current) => current.map((item, position) => position === index ? current[index - 1] : position === index - 1 ? current[index] : item))}>↑</Button><Button type="button" size="icon-xs" variant="ghost" aria-label="Move item down" disabled={index === lines.length - 1} onClick={() => setLines((current) => current.map((item, position) => position === index ? current[index + 1] : position === index + 1 ? current[index] : item))}>↓</Button></div></TableCell>
                <TableCell><Button type="button" size="icon-xs" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>×</Button></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          <div className="grid min-w-56 gap-1 text-right text-sm">
            <div className="flex justify-between gap-6"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
            {discountMinor > 0n && <div className="flex justify-between gap-6"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">-{money(discountMinor)}</span></div>}
            {taxInclusive && <div className="flex justify-between gap-6"><span className="text-muted-foreground">Taxable subtotal</span><span className="tabular-nums">{money(taxableSubtotal)}</span></div>}
            {invoiceTemplate.visibility.tax && <div className="flex justify-between gap-6"><span className="text-muted-foreground">Tax [VERIFY]</span><span className="tabular-nums">{money(tax)}</span></div>}
            <div className="flex justify-between gap-6 border-t pt-1 font-semibold text-green-700"><span>Total due</span><span className="tabular-nums">{money(total)}</span></div>
          </div>
        </div>
        <section className={`rounded-lg border bg-background ${invoiceTemplate.layout === "compact" ? "p-3" : "p-4"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
            <div className="flex items-center gap-3" style={{ flexDirection: invoiceTemplate.logoAlignment === "right" ? "row-reverse" : "row" }}>
              {invoiceTemplate.visibility.logo && (issuerProfile.logo
                ? <img src={issuerProfile.logo} alt="" className={`${invoiceTemplate.logoSize === "large" ? "h-16 w-16" : invoiceTemplate.logoSize === "small" ? "h-9 w-9" : "h-12 w-12"} rounded-md border object-contain p-1`} />
                : <div className={`grid place-items-center rounded-md text-sm font-bold text-white ${invoiceTemplate.logoSize === "large" ? "size-16" : invoiceTemplate.logoSize === "small" ? "size-9" : "size-12"}`} style={{ backgroundColor: invoiceTemplate.accentColor }}>{(issuerProfile.name || "Business").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</div>)}
              <div><p className="font-semibold">{issuerProfile.legalName || issuerProfile.name || "Your business name"}</p><p className="text-xs text-muted-foreground">{[issuerProfile.address, issuerProfile.email, issuerProfile.phone].filter(Boolean).join(" · ") || "Business contact details will appear here"}</p></div>
            </div>
            <div className="text-right"><p className="text-lg font-semibold tracking-wide" style={{ color: invoiceTemplate.accentColor }}>{invoiceTemplate.title}</p><p className="text-xs text-muted-foreground">{isBatch ? "Sequential invoice number per customer" : invoiceNumber.trim() || "Sequential invoice number"}</p></div>
          </div>
          <div className="grid gap-3 py-3 text-sm sm:grid-cols-3">
            {isBatch && <label className="grid gap-1 text-xs font-medium">Preview customer<select className="h-8 rounded-md border bg-background px-2 text-sm" value={previewCustomer?.id ?? ""} onChange={(event) => setPreviewCustomerId(event.target.value)}>{batchCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
            <p><span className="text-xs text-muted-foreground">Bill to</span><br />{previewCustomer?.name || "Select a customer"}{previewCustomer?.billingAddress && <><br />{previewCustomer.billingAddress}</>}{invoiceTemplate.visibility.customerEmail && previewCustomer?.email && <><br />{previewCustomer.email}</>}</p>
            <p><span className="text-xs text-muted-foreground">Invoice date</span><br />{invoiceDate}</p>
            <p><span className="text-xs text-muted-foreground">Due date</span><br />{dueDate}</p>
          </div>
          {invoiceTemplate.visibility.reference && reference.trim() && <p className="mb-2 text-sm"><span className="text-xs text-muted-foreground">PO / Reference</span><br />{reference}</p>}
          <div className={`divide-y border-y ${invoiceTemplate.layout === "compact" ? "text-xs" : "text-sm"}`}>
            {lines.map((line, index) => <div key={index} className="flex justify-between gap-3 py-2"><span>{line.description || `Line item ${index + 1}`} · {line.quantity} × {line.rate ? money(parseMinor(line.rate) ?? 0n) : "₱0.00"}</span><span className="shrink-0 tabular-nums">{money(lineAmount(line) ?? 0n)}</span></div>)}
          </div>
          <div className="ml-auto mt-3 grid max-w-64 gap-1 text-right text-sm">
            <p className="flex justify-between gap-4"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal)}</span></p>
            {invoiceTemplate.visibility.discount && discountMinor > 0n && <p className="flex justify-between gap-4"><span className="text-muted-foreground">Discount</span><span>-{money(discountMinor)}</span></p>}
            {taxInclusive && <p className="flex justify-between gap-4"><span className="text-muted-foreground">Taxable subtotal</span><span>{money(taxableSubtotal)}</span></p>}
            {invoiceTemplate.visibility.tax && <p className="flex justify-between gap-4"><span className="text-muted-foreground">Tax [VERIFY]</span><span>{money(tax)}</span></p>}
          </div>
          {invoiceTemplate.visibility.paymentNotes && <p className="text-xs text-muted-foreground">{invoiceTemplate.paymentInstructions || invoiceTemplate.terms || "Payment instructions and terms preview here."}</p>}
          {invoiceTemplate.visibility.preparedBy && invoiceTemplate.preparedBy && <p className="mt-2 text-xs text-muted-foreground">Prepared by: {invoiceTemplate.preparedBy}</p>}
          <p className="text-right text-sm font-semibold">Total due <span className="ml-3 text-green-700">{money(total)}</span></p>
          <p className="mt-1 text-right text-xs text-muted-foreground">Live preview · {lines.length} line item{lines.length === 1 ? "" : "s"}</p>
        </section>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" disabled={!canSaveInvoice} onClick={previewCurrentInvoice}>Preview / print</Button>
          <Button type="button" variant="outline" disabled={!canSaveInvoice || saving} onClick={saveInvoice}>{saving ? "Saving…" : isBatch ? "Save batch drafts" : "Save draft"}</Button>
          {canIssue && <Button type="submit" disabled={!canSaveInvoice || saving}>{saving ? "Saving…" : isBatch ? "Issue batch" : "Issue invoice"}</Button>}
          {editingInvoiceId && <Button type="button" variant="outline" onClick={clearInvoiceForm}>Cancel edit</Button>}
        </div>
      </form>}

      <section className="overflow-hidden rounded-xl border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-medium">Invoices</h2>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant={section === "invoices" ? "default" : "outline"} onClick={() => setSection("invoices")}>Invoices</Button>
              <Button size="sm" variant={section === "aging" ? "default" : "outline"} onClick={() => setSection("aging")}>Aging</Button>
              <Button size="sm" variant={section === "payments" ? "default" : "outline"} onClick={() => setSection("payments")}>Payments</Button>
              {canRecordPayment && <Button size="sm" variant="outline" onClick={() => setShowPaymentForm((show) => !show)}>Record payment</Button>}
            </div>
          </div>
          {section === "invoices" && <select aria-label="Invoice status filter" className="h-8 rounded-md border bg-background px-2 text-sm" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : status[0].toUpperCase() + status.slice(1)}</option>)}</select>}
        </div>
        {canRecordPayment && showPaymentForm && (
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
              <TableCell><div className="flex gap-1">{canIssue && invoice.status === "draft" && <Button size="sm" variant="outline" disabled={saving} onClick={() => issueInvoice(invoice.id)}>Issue</Button>}{canIssue && invoice.status === "draft" && <Button size="sm" variant="outline" disabled={saving} onClick={() => voidInvoice(invoice.id)}>Void</Button>}{invoice.status !== "draft" && invoice.status !== "void" && <Button size="sm" variant="outline" onClick={() => setSelectedId(invoice.id)}>View</Button>}</div></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        )}
      </section>

      {detail?.invoice && detail.invoice.id === selectedId && (
        <section className="space-y-3 rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-medium">Invoice detail · {detail.invoice.invoiceNumber}</h2><p className="text-sm text-muted-foreground">{detail.invoice.customerName} · <StatusBadge status={detail.invoice.status} /></p></div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => printInvoice(detail.invoice, detail.lines, detail.invoice.issuerProfile, detail.invoice.template)}>Print / PDF</Button>
              {canCreate && detail.invoice.status === "draft" && <Button type="button" variant="outline" onClick={() => { editDraft(detail.invoice, detail.lines); setSelectedId(""); }}>Edit draft</Button>}
              {canIssue && detail.invoice.status === "draft" && <Button type="button" variant="outline" onClick={() => voidInvoice(detail.invoice.id)}>Void draft</Button>}
              {canIssue && ["sent", "partially paid", "overdue"].includes(detail.invoice.status) && <Button type="button" variant="outline" onClick={() => createCreditNote(detail.invoice)}>Credit note</Button>}
              <Button type="button" variant="outline" onClick={() => setSelectedId("")}>Close</Button>
            </div>
          </div>
          <Table><TableHeader><TableRow><TableHead>Item / Account</TableHead><TableHead>Description</TableHead><TableHead>Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{detail.lines.map((line) => <TableRow key={line.id}><TableCell>4000 — Service Revenue</TableCell><TableCell>{line.description}</TableCell><TableCell>{(Number(line.quantityMilli) / 1000).toFixed(3).replace(/\.?0+$/, "")}</TableCell><TableCell className="text-right">{money(line.unitPriceMinor)}</TableCell><TableCell className="text-right">{money(line.amountMinor)}</TableCell></TableRow>)}</TableBody>
          </Table>
          <div className="grid justify-end gap-1 text-right text-sm"><p>Subtotal: {money(detail.invoice.subtotalMinor)}</p><p>Tax [VERIFY]: {money(detail.invoice.taxMinor)}</p><p className="font-semibold">Total: {money(detail.invoice.totalMinor)}</p><p>Paid: {money(detail.invoice.appliedMinor)}</p><p>Credits: {money(detail.invoice.creditMinor)}</p><p className="font-semibold text-green-700">Balance due: {money(detail.invoice.remainingMinor)}</p></div>
          {detail.creditNotes?.length > 0 && <div><h3 className="font-medium">Credit notes</h3><ul className="mt-2 space-y-1 text-sm">{detail.creditNotes.map((note) => <li key={note.id}>{note.creditNumber} · {note.creditDate} · {money(note.amountMinor)} · {note.reason}</li>)}</ul></div>}
          {canIssue && detail.invoice.status === "draft" && <Button type="button" disabled={saving} onClick={() => issueInvoice(detail.invoice.id)}>{saving ? "Issuing…" : "Issue invoice"}</Button>}
        </section>
      )}
    </section>
  );
}
