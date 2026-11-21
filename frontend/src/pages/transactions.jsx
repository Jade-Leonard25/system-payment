import { useEffect, useRef, useState } from "react";
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

const minorToCurrency = (minor) => {
  const amount = BigInt(minor ?? 0);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${sign}₱${new Intl.NumberFormat("en-PH").format(whole)}.${fraction}`;
};

const parseMinorUnits = (value) => {
  if (value === "") return 0n;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value);
  if (!match) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount : null;
};

const emptyLine = () => ({ accountId: "", accountQuery: "", description: "", debitMinor: "", creditMinor: "" });

export default function TransactionsPage({ companyId }) {
  const [tab, setTab] = useState("entries");
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [attachments, setAttachments] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const gridRef = useRef(null);

  const debitTotal = lines.reduce((sum, line) => sum + (parseMinorUnits(line.debitMinor) ?? 0n), 0n);
  const creditTotal = lines.reduce((sum, line) => sum + (parseMinorUnits(line.creditMinor) ?? 0n), 0n);
  const differenceMinor = debitTotal - creditTotal;
  const amountsValid = lines.every((line) => parseMinorUnits(line.debitMinor) !== null && parseMinorUnits(line.creditMinor) !== null);
  const validLineCount = lines.filter((line) => line.accountId && (
    (parseMinorUnits(line.debitMinor) ?? 0n) > 0n || (parseMinorUnits(line.creditMinor) ?? 0n) > 0n
  )).length;
  const canSubmitEntry = amountsValid && differenceMinor === 0n && debitTotal > 0n && validLineCount >= 2;

  const load = async () => {
    if (!companyId) return;
    setIsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ companyId });
      if (filterStatus) query.set("status", filterStatus);
      const [accountResult, entryResult] = await Promise.all([
        apiRequest(`/api/ledger/accounts?${query}`),
        apiRequest(`/api/ledger/entries?${query}`),
      ]);
      setAccounts(Array.isArray(accountResult?.data) ? accountResult.data : []);
      setEntries(Array.isArray(entryResult?.data) ? entryResult.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load transactions.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!companyId) return undefined;
    const run = async () => {
      setIsLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ companyId });
        if (filterStatus) query.set("status", filterStatus);
        const [accountResult, entryResult] = await Promise.all([
          apiRequest(`/api/ledger/accounts?${query}`),
          apiRequest(`/api/ledger/entries?${query}`),
        ]);
        if (!active) return;
        setAccounts(Array.isArray(accountResult?.data) ? accountResult.data : []);
        setEntries(Array.isArray(entryResult?.data) ? entryResult.data : []);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load transactions.");
      } finally {
        if (active) setIsLoading(false);
      }
    };
    run();
    return () => { active = false; };
  }, [companyId, filterStatus]);

  useEffect(() => {
    let active = true;
    if (!selectedId || !companyId) return undefined;
    const query = new URLSearchParams({ companyId });
    apiRequest(`/api/ledger/entries/${encodeURIComponent(selectedId)}?${query}`)
      .then((result) => { if (active) setDetail(result?.data ?? null); })
      .catch((detailError) => { if (active) setError(detailError instanceof Error ? detailError.message : "Could not load journal entry."); });
    return () => { active = false; };
  }, [companyId, selectedId]);

  const updateLine = (index, key, value) => {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (key === "accountQuery") {
        const query = value.trim().toLocaleLowerCase();
        const account = accounts.find((item) =>
          item.code.toLocaleLowerCase() === query ||
          item.name.toLocaleLowerCase() === query ||
          `${item.code} — ${item.name}`.toLocaleLowerCase() === query
        );
        return { ...line, accountQuery: value, accountId: account?.id ?? "" };
      }
      if (key === "debitMinor") return { ...line, debitMinor: value, creditMinor: "" };
      if (key === "creditMinor") return { ...line, creditMinor: value, debitMinor: "" };
      return { ...line, [key]: value };
    }));
  };

  const handleGridKeyDown = (event) => {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      event.preventDefault();
      const controls = gridRef.current?.querySelectorAll("input, select");
      if (!controls) return;
      const index = Array.from(controls).indexOf(target);
      const next = controls[index + 1];
      if (next) {
        next.focus();
      } else {
        setLines((current) => [...current, emptyLine()]);
        requestAnimationFrame(() => gridRef.current?.querySelector("tbody tr:last-child input")?.focus());
      }
    }
  };

  const handleAttachment = async (event) => {
    try {
      const files = Array.from(event.target.files ?? []).slice(0, 10);
      const converted = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        if (file.size > 150000) return reject(new Error("Each attachment must be 150 KB or smaller in this stage."));
        const reader = new FileReader();
        reader.onload = () => resolve({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64: String(reader.result).split(",")[1] ?? "",
        });
        reader.onerror = () => reject(new Error("Could not read the attachment."));
        reader.readAsDataURL(file);
      })));
      setAttachments(converted);
      setError("");
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : "Could not read the attachment.");
    }
  };

  const saveDraft = async () => {
    setError("");
    if (!canSubmitEntry) {
      setError("Enter at least two valid lines with equal, positive debits and credits before saving.");
      return "";
    }
    setIsSaving(true);
    try {
      const normalizedLines = lines.map((line) => ({
        accountId: line.accountId,
        description: line.description || null,
        debitMinor: Number(parseMinorUnits(line.debitMinor) ?? 0n),
        creditMinor: Number(parseMinorUnits(line.creditMinor) ?? 0n),
      })).filter((line) => line.accountId && (line.debitMinor > 0 || line.creditMinor > 0));
      const result = await apiRequest("/api/ledger/entries", {
        method: "POST",
        body: {
          companyId,
          entryDate,
          currency: "PHP",
          reference: reference || null,
          description: description || null,
          lines: normalizedLines,
          attachments,
        },
      });
      setSelectedId(result?.data?.id ?? "");
      setTab("entries");
      await load();
      return result?.data?.id ?? "";
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the draft.");
      return "";
    } finally {
      setIsSaving(false);
    }
  };

  const postNewEntry = async () => {
    const id = await saveDraft();
    if (id) await postEntry(id);
  };

  const submitForApproval = async () => {
    const id = await saveDraft();
    if (!id) return;
    setError("");
    setIsPosting(true);
    try {
      await apiRequest(`/api/ledger/entries/${encodeURIComponent(id)}/submit`, {
        method: "POST",
        body: { companyId },
      });
      await load();
      setSelectedId(id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit the entry for approval.");
    } finally {
      setIsPosting(false);
    }
  };

  const postEntry = async (id) => {
    setError("");
    setIsPosting(true);
    try {
      await apiRequest(`/api/ledger/entries/${encodeURIComponent(id)}/post`, {
        method: "POST",
        body: { companyId },
      });
      await load();
      setSelectedId(id);
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Could not post the entry.");
    } finally {
      setIsPosting(false);
    }
  };

  const reverseEntry = async (id) => {
    if (!reverseReason.trim()) {
      setError("A reversal reason is required.");
      return;
    }
    setError("");
    setIsPosting(true);
    try {
      await apiRequest(`/api/ledger/entries/${encodeURIComponent(id)}/reverse`, {
        method: "POST",
        body: { companyId, reason: reverseReason.trim() },
      });
      setReverseReason("");
      await load();
      setSelectedId(id);
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "Could not reverse the entry.");
    } finally {
      setIsPosting(false);
    }
  };

  if (!companyId) {
    return (
      <section className="rounded-xl border bg-background p-6">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="mt-2 text-sm text-muted-foreground">Select a company to manage accounts and journal entries.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Chart of accounts and journal entries.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={tab === "entries" ? "default" : "outline"} onClick={() => setTab("entries")}>Journal entries</Button>
          <Button type="button" variant={tab === "accounts" ? "default" : "outline"} onClick={() => setTab("accounts")}>Chart of accounts</Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}

      {tab === "accounts" ? (
        <AccountsTab companyId={companyId} accounts={accounts} isLoading={isLoading} onChanged={load} />
      ) : (
        <>
          <section className="rounded-xl border bg-background p-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-medium">New journal entry</h2>
                <p className="text-sm text-muted-foreground">Enter amounts in Philippine pesos with two decimal places.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-2 text-right text-sm">
                <span className="text-muted-foreground">Debits</span><strong>{minorToCurrency(debitTotal)}</strong>
                <span className="text-muted-foreground">Credits</span><strong>{minorToCurrency(creditTotal)}</strong>
                <span className="text-muted-foreground">Difference</span><strong className={differenceMinor === 0n ? "text-green-700" : "text-destructive"}>{minorToCurrency(differenceMinor < 0n ? -differenceMinor : differenceMinor)}{differenceMinor !== 0n ? (differenceMinor > 0n ? " Dr" : " Cr") : ""}</strong>
              </div>
            </div>
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-xs font-medium">Entry date<Input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
              <label className="grid gap-1 text-xs font-medium">Reference<Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional reference" /></label>
              <label className="grid gap-1 text-xs font-medium">Description<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Journal description" /></label>
            </div>
            <div ref={gridRef} className="overflow-x-auto rounded-lg border" onKeyDown={handleGridKeyDown}>
              <Table>
                <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Description</TableHead><TableHead>Debit</TableHead><TableHead>Credit</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          className="min-w-52"
                          list={`ledger-accounts-${companyId}`}
                          value={line.accountQuery}
                          onChange={(event) => updateLine(index, "accountQuery", event.target.value)}
                          placeholder="Search account code or name"
                          aria-label={`Account for line ${index + 1}`}
                        />
                      </TableCell>
                      <TableCell><Input value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} /></TableCell>
                      <TableCell><Input type="text" inputMode="decimal" value={line.debitMinor} onChange={(event) => updateLine(index, "debitMinor", event.target.value)} aria-invalid={parseMinorUnits(line.debitMinor) === null} /></TableCell>
                      <TableCell><Input type="text" inputMode="decimal" value={line.creditMinor} onChange={(event) => updateLine(index, "creditMinor", event.target.value)} aria-invalid={parseMinorUnits(line.creditMinor) === null} /></TableCell>
                      <TableCell><Button type="button" size="icon-xs" variant="ghost" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} aria-label="Remove line">×</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <datalist id={`ledger-accounts-${companyId}`}>
                {accounts.filter((account) => account.isActive && account.isPostable).map((account) => (
                  <option key={account.id} value={`${account.code} — ${account.name}`} />
                ))}
              </datalist>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
                <label className="text-sm"><input type="file" multiple onChange={handleAttachment} accept="image/*,.pdf,.csv,.txt" /><span className="sr-only">Attachments</span></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!canSubmitEntry || isSaving || isPosting} onClick={saveDraft}>{isSaving ? "Saving…" : "Save draft"}</Button>
                <Button type="button" variant="outline" disabled={!canSubmitEntry || isSaving || isPosting} onClick={submitForApproval}>Submit for approval</Button>
                <Button type="button" disabled={!canSubmitEntry || isSaving || isPosting} onClick={postNewEntry}>{isPosting ? "Posting…" : "Post"}</Button>
              </div>
            </div>
            {attachments.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{attachments.length} attachment(s) ready.</p>}
          </section>

          <section className="overflow-hidden rounded-xl border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <h2 className="font-medium">Journal entries</h2>
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="pending approval">Pending approval</option>
                <option value="posted">Posted</option>
                <option value="voided">Voided</option>
              </select>
            </div>
            {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading journal entries…</p> : entries.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No journal entries yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Voucher</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
                <TableBody>{entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell><button className="underline-offset-4 hover:underline" type="button" onClick={() => setSelectedId(entry.id)}>{entry.entryDate}</button></TableCell>
                    <TableCell>{entry.voucherNumber || "—"}</TableCell>
                    <TableCell>{entry.description || entry.reference || "—"}</TableCell>
                    <TableCell>{entry.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{minorToCurrency(entry.totalDebitMinor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{minorToCurrency(entry.totalCreditMinor)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </section>

          {detail && (
            <section className="space-y-3 rounded-xl border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-medium">Entry detail</h2><p className="text-sm text-muted-foreground">{detail.entry.voucherNumber || "Not posted"} · {detail.entry.status}</p></div>
                {detail.entry.status === "draft" && <Button type="button" disabled={isPosting} onClick={() => postEntry(detail.entry.id)}>{isPosting ? "Posting…" : "Post"}</Button>}
                {detail.entry.status === "posted" && (
                  <div className="flex items-end gap-2"><label className="grid gap-1 text-xs">Reversal reason<Input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} /></label><Button type="button" variant="outline" disabled={isPosting} onClick={() => reverseEntry(detail.entry.id)}>Reverse</Button></div>
                )}
              </div>
              <Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
                <TableBody>{detail.lines.map((line) => <TableRow key={line.id}><TableCell>{line.accountCode} — {line.accountName}</TableCell><TableCell>{line.description || "—"}</TableCell><TableCell className="text-right">{minorToCurrency(line.debitMinor)}</TableCell><TableCell className="text-right">{minorToCurrency(line.creditMinor)}</TableCell></TableRow>)}</TableBody>
              </Table>
              {detail.attachments.length > 0 && <p className="text-sm">Attachments: {detail.attachments.map((item) => item.fileName).join(", ")}</p>}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function AccountsTab({ companyId, accounts, isLoading, onChanged }) {
  const emptyForm = () => ({ id: "", code: "", name: "", type: "asset", normalBalance: "debit", isHeader: false, isPostable: true, isActive: true, parentId: null });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveAccount = async (event) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const { id, ...accountData } = form;
      const editing = Boolean(id);
      await apiRequest(
        editing
          ? `/api/ledger/accounts/${encodeURIComponent(id)}?companyId=${encodeURIComponent(companyId)}`
          : "/api/ledger/accounts",
        { method: editing ? "PUT" : "POST", body: editing ? accountData : { companyId, ...accountData } },
      );
      setForm(emptyForm());
      await onChanged();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save account."); }
    finally { setSaving(false); }
  };
  const deactivate = async (account) => {
    setError("");
    try {
      await apiRequest(`/api/ledger/accounts/${encodeURIComponent(account.id)}?companyId=${encodeURIComponent(companyId)}`, { method: "PUT", body: { ...account, isActive: false, isHeader: Boolean(account.isHeader), isPostable: Boolean(account.isPostable) } });
      await onChanged();
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "Could not deactivate account."); }
  };
  const accountDepth = (account) => {
    const visited = new Set([account.id]);
    let parentId = account.parentId;
    let depth = 0;
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = accounts.find((item) => item.id === parentId);
      if (!parent) break;
      depth += 1;
      parentId = parent.parentId;
    }
    return depth;
  };
  return (
    <>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      <form onSubmit={saveAccount} className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-6">
        <h2 className="font-medium sm:col-span-6">{form.id ? "Edit account" : "Add account"}</h2>
        <label className="grid gap-1 text-xs font-medium">Code<Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} required /></label>
        <label className="grid gap-1 text-xs font-medium sm:col-span-2">Name<Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
        <label className="grid gap-1 text-xs font-medium">Type<select className="h-8 rounded-md border bg-background px-2 text-sm" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option>asset</option><option>liability</option><option>equity</option><option>revenue</option><option>expense</option></select></label>
        <label className="grid gap-1 text-xs font-medium">Normal balance<select className="h-8 rounded-md border bg-background px-2 text-sm" value={form.normalBalance} onChange={(event) => setForm((current) => ({ ...current, normalBalance: event.target.value }))}><option>debit</option><option>credit</option></select></label>
        <label className="grid gap-1 text-xs font-medium">Parent account<select className="h-8 rounded-md border bg-background px-2 text-sm" value={form.parentId ?? ""} onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value || null }))}><option value="">No parent</option>{accounts.filter((account) => account.id !== form.id).map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
        <div className="flex items-end gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : form.id ? "Save changes" : "Add account"}</Button>{form.id && <Button type="button" variant="outline" onClick={() => setForm(emptyForm())}>Cancel</Button>}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isHeader} onChange={(event) => setForm((current) => ({ ...current, isHeader: event.target.checked, isPostable: event.target.checked ? false : current.isPostable }))} /> Header account</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPostable} disabled={form.isHeader} onChange={(event) => setForm((current) => ({ ...current, isPostable: event.target.checked }))} /> Postable</label>
      </form>
      <div className="overflow-hidden rounded-xl border bg-background">
        {accounts.some((account) => account.id.startsWith("demo-")) && <p className="border-b px-4 py-3 text-xs text-muted-foreground">Demo starter accounts [VERIFY] are editable defaults, not legal requirements.</p>}
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading accounts…</p> : accounts.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No accounts found.</p> : (
          <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Normal</TableHead><TableHead>Flags</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>{accounts.map((account) => {
              const depth = accountDepth(account);
              return <TableRow key={account.id}><TableCell>{account.code}</TableCell><TableCell><span style={{ paddingLeft: `${depth * 20}px` }}>{account.name}</span></TableCell><TableCell>{account.type}</TableCell><TableCell>{account.normalBalance}</TableCell><TableCell>{account.isHeader ? "Header" : account.isPostable ? "Postable" : "Non-postable"} · {account.isActive ? "Active" : "Inactive"}</TableCell><TableCell><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setForm({ id: account.id, code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance, isHeader: Boolean(account.isHeader), isPostable: Boolean(account.isPostable), isActive: Boolean(account.isActive), parentId: account.parentId ?? null })}>Edit</Button>{account.isActive && <Button type="button" size="sm" variant="outline" onClick={() => deactivate(account)}>Deactivate</Button>}</div></TableCell></TableRow>;
            })}</TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
