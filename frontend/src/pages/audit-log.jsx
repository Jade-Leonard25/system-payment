import { useEffect, useState } from "react";
import { Link } from "react-router";
import { apiRequest } from "../api-client";
import { Button } from "../components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "../components/ui/drawer";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const PAGE_SIZE = 100;
const emptyFilters = { from: "", to: "", user: "", action: "", resource: "" };

function buildQuery(companyId, filters, extra = {}) {
  const query = new URLSearchParams({ companyId, ...extra });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  return query.toString();
}

function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function parseState(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatValue(value) {
  if (value === undefined) return "—";
  if (value === null) return "null";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function stateDiff(beforeValue, afterValue) {
  const before = parseState(beforeValue);
  const after = parseState(afterValue);
  const beforeIsObject =
    before !== null && typeof before === "object" && !Array.isArray(before);
  const afterIsObject =
    after !== null && typeof after === "object" && !Array.isArray(after);
  const keys =
    beforeIsObject || afterIsObject
      ? [...new Set([
          ...(beforeIsObject ? Object.keys(before) : []),
          ...(afterIsObject ? Object.keys(after) : []),
        ])]
      : ["value"];

  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">No state recorded.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="p-2 font-medium">Field</th>
            <th className="p-2 font-medium">Before</th>
            <th className="p-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const previous =
              key === "value" && !beforeIsObject ? before : before?.[key];
            const next = key === "value" && !afterIsObject ? after : after?.[key];
            return (
              <tr className="border-b last:border-0" key={key}>
                <th className="max-w-40 p-2 align-top font-medium">{key}</th>
                <td className="max-w-72 whitespace-pre-wrap break-words p-2 align-top">
                  {formatValue(previous)}
                </td>
                <td className="max-w-72 whitespace-pre-wrap break-words p-2 align-top">
                  {formatValue(next)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditLogPage({
  companyId,
  canView,
  isCheckingAccess = false,
  permissionError = "",
}) {
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [eventPage, setEventPage] = useState({ companyId: "", rows: [] });
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [detailResult, setDetailResult] = useState(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [integrityResult, setIntegrityResult] = useState(null);
  const [integrityError, setIntegrityError] = useState(null);
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const requestKey = JSON.stringify([companyId, filters, offset, reloadKey]);
  const detailKey = JSON.stringify([companyId, selectedEventId]);
  const currentLoadError =
    loadError?.key === requestKey ? loadError.message : "";
  const events = eventPage.key === requestKey ? eventPage.rows : [];
  const isLoading =
    Boolean(companyId && canView) &&
    eventPage.key !== requestKey &&
    !currentLoadError;
  const currentDetail =
    detailResult?.key === detailKey ? detailResult : null;
  const isLoadingDetail =
    Boolean(selectedEventId && canView) &&
    !currentDetail;
  const detailError = currentDetail?.error ?? "";
  const currentIntegrityResult =
    integrityResult?.companyId === companyId ? integrityResult : null;
  const currentIntegrityError =
    integrityError?.companyId === companyId ? integrityError.message : "";

  useEffect(() => {
    let active = true;
    if (!companyId || !canView) {
      return undefined;
    }

    const query = buildQuery(companyId, filters, {
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    apiRequest(`/api/audit?${query}`)
      .then((result) => {
        if (active) {
          setEventPage({
            key: requestKey,
            rows: Array.isArray(result?.data) ? result.data : [],
          });
        }
      })
      .catch((error) => {
        if (active) {
          setEventPage({ key: requestKey, rows: [] });
          setLoadError({
            key: requestKey,
            message:
              error instanceof Error
                ? error.message
                : "Could not load the audit log.",
          });
        }
      })

    return () => {
      active = false;
    };
  }, [canView, companyId, filters, offset, reloadKey, requestKey]);

  useEffect(() => {
    let active = true;
    if (!selectedEventId || !companyId || !canView) {
      return undefined;
    }

    const query = new URLSearchParams({ companyId });
    apiRequest(`/api/audit/${encodeURIComponent(selectedEventId)}?${query}`)
      .then((result) => {
        if (active) {
          setDetailResult({ key: detailKey, data: result?.data ?? null });
        }
      })
      .catch((error) => {
        if (active) {
          setDetailResult({
            key: detailKey,
            error:
              error instanceof Error
                ? error.message
                : "Could not load this audit event.",
          });
        }
      })
    return () => {
      active = false;
    };
  }, [canView, companyId, detailKey, selectedEventId]);
  const selectedEventForDrawer =
    currentDetail?.data?.id === selectedEventId
      ? currentDetail.data
      : null;

  const updateDraftFilter = (key, value) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({ ...draftFilters });
    setOffset(0);
  };

  const exportCsv = async () => {
    setExportError("");
    setIsExporting(true);
    try {
      const query = buildQuery(companyId, filters);
      const csv = await apiRequest(`/api/audit/export.csv?${query}`, {
        responseType: "text",
      });
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-log.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Could not export the audit log.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const checkIntegrity = async () => {
    setIntegrityError(null);
    setIntegrityResult(null);
    setIsCheckingIntegrity(true);
    try {
      const query = new URLSearchParams({ companyId });
      setIntegrityResult({
        companyId,
        ...(await apiRequest(`/api/audit/integrity?${query}`)),
      });
    } catch (error) {
      setIntegrityError({
        companyId,
        message:
          error instanceof Error
            ? error.message
            : "Could not verify the audit chain.",
      });
    } finally {
      setIsCheckingIntegrity(false);
    }
  };

  if (!companyId) {
    return (
      <section className="rounded-xl border bg-background p-6">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Select a company to view its audit events.
        </p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="rounded-xl border bg-background p-6">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p role={permissionError ? "alert" : "status"} className="mt-2 text-sm">
          {isCheckingAccess
            ? "Checking audit-log access…"
            : permissionError ||
              "You do not have permission to view this company’s audit log."}
        </p>
        <Link className="mt-4 inline-block text-sm underline" to="/dashboard">
          Return to overview
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Append-only activity history for the selected company.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={checkIntegrity}
              disabled={isCheckingIntegrity}
            >
              {isCheckingIntegrity ? "Verifying…" : "Check integrity"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={exportCsv}
              disabled={isExporting}
            >
              {isExporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>

        <form
          onSubmit={applyFilters}
          className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="grid gap-1 text-xs font-medium">
            From
            <Input
              type="date"
              value={draftFilters.from}
              onChange={(event) => updateDraftFilter("from", event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            To
            <Input
              type="date"
              value={draftFilters.to}
              onChange={(event) => updateDraftFilter("to", event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            User
            <Input
              value={draftFilters.user}
              onChange={(event) => updateDraftFilter("user", event.target.value)}
              placeholder="Name, email, or ID"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Action
            <Input
              value={draftFilters.action}
              onChange={(event) => updateDraftFilter("action", event.target.value)}
              placeholder="Exact action"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Resource
            <Input
              value={draftFilters.resource}
              onChange={(event) => updateDraftFilter("resource", event.target.value)}
              placeholder="Type or resource ID"
            />
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit">Apply filters</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftFilters(emptyFilters);
                setFilters(emptyFilters);
                setOffset(0);
              }}
            >
              Clear
            </Button>
          </div>
        </form>

        {(currentIntegrityResult || currentIntegrityError) && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              currentIntegrityResult?.valid
                ? "border-green-600/30 bg-green-500/5"
                : "border-destructive/40 bg-destructive/5"
            }`}
            role={currentIntegrityError || !currentIntegrityResult?.valid ? "alert" : "status"}
          >
            {currentIntegrityError
              ? `Integrity check failed to run: ${currentIntegrityError}`
              : currentIntegrityResult?.valid
                ? `Integrity check passed. ${currentIntegrityResult.checked} event(s) verified.`
                : `Integrity check failed after ${currentIntegrityResult?.checked ?? 0} event(s): ${currentIntegrityResult?.error ?? "Unknown chain error"}`}
          </div>
        )}
        {currentLoadError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm" role="alert">
            <span>{currentLoadError}</span>
            <Button type="button" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        )}
        {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}

        <div className="overflow-hidden rounded-xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Request ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Loading audit events…
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    {currentLoadError ? "Audit events could not be loaded." : "No audit events match these filters."}
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline"
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        {displayDate(event.occurredAt)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div>{event.actorName || "System / deleted user"}</div>
                      <div className="text-xs text-muted-foreground">
                        {event.actorEmail || event.actorId || "No actor"}
                      </div>
                    </TableCell>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>
                      {event.resourceType}
                      {event.resourceId ? ` · ${event.resourceId}` : ""}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs">
                      {event.requestId}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {events.length ? `Showing ${offset + 1}–${offset + events.length}` : "No results"}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={offset === 0 || isLoading}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={events.length < PAGE_SIZE || isLoading}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      <Drawer
        open={Boolean(selectedEventId)}
        onOpenChange={(open) => {
          if (!open) setSelectedEventId("");
        }}
      >
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="mx-auto w-full max-w-4xl">
            <DrawerTitle>Audit event details</DrawerTitle>
            <DrawerDescription>
              Immutable event metadata and recorded before/after state.
            </DrawerDescription>
          </DrawerHeader>
          <div className="mx-auto w-full max-w-4xl space-y-5 overflow-y-auto p-4 pb-8">
            {isLoadingDetail && <p role="status">Loading event details…</p>}
            {detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
            {selectedEventForDrawer && (
              <>
                <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Action</dt><dd>{selectedEventForDrawer.action}</dd></div>
                  <div><dt className="text-muted-foreground">Date / UTC</dt><dd>{selectedEventForDrawer.occurredAt}</dd></div>
                  <div><dt className="text-muted-foreground">Actor</dt><dd>{selectedEventForDrawer.actorName || selectedEventForDrawer.actorId || "System"}</dd></div>
                  <div><dt className="text-muted-foreground">Resource</dt><dd>{selectedEventForDrawer.resourceType} {selectedEventForDrawer.resourceId || ""}</dd></div>
                  <div><dt className="text-muted-foreground">Request ID</dt><dd className="break-all font-mono text-xs">{selectedEventForDrawer.requestId}</dd></div>
                  <div><dt className="text-muted-foreground">Source IP</dt><dd>{selectedEventForDrawer.ipAddress || "Unavailable"}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-muted-foreground">Entry hash</dt><dd className="break-all font-mono text-xs">{selectedEventForDrawer.entryHash}</dd></div>
                </dl>
                <section className="space-y-2">
                  <h2 className="font-medium">Before / after diff</h2>
                  {stateDiff(selectedEventForDrawer.beforeJson, selectedEventForDrawer.afterJson)}
                </section>
                <section className="space-y-2">
                  <h2 className="font-medium">Additional metadata</h2>
                  <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs">
                    {formatValue(parseState(selectedEventForDrawer.metadataJson))}
                  </pre>
                </section>
                <p className="break-all text-xs text-muted-foreground">
                  Previous hash: <span className="font-mono">{selectedEventForDrawer.previousHash}</span>
                </p>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
