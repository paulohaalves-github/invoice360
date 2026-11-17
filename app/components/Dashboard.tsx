"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  endOfUtcMonth,
  monthsAgoUtc,
  startOfUtcMonth,
  startOfUtcYear,
  toIsoDate,
} from "@/lib/invoice-filters";
import type {
  DashboardStats,
  InvoiceKind,
  InvoiceRow,
  InvoiceSummaryByNumber,
  MonthlySummary,
  SyncResult,
  UnassignedSummary,
} from "@/lib/types";

type PeriodPreset = "all" | "month" | "3m" | "ytd" | "custom";

type LoadFilters = {
  whatsapp?: string[];
  issueFrom?: string;
  issueTo?: string;
  kind?: InvoiceKind | "all";
  unassigned?: boolean;
};

type ApiPayload = {
  numbers: string[];
  summary: InvoiceSummaryByNumber[];
  unassigned: UnassignedSummary | null;
  monthly: MonthlySummary[];
  invoices: InvoiceRow[];
  stats: DashboardStats;
  labels: Record<string, string>;
};

const PAGE_SIZE = 25;

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPhone(value: string | null) {
  if (!value) return "—";
  if (value.length === 12 && value.startsWith("55")) {
    return `+${value.slice(0, 2)} (${value.slice(2, 4)}) ${value.slice(4, 8)}-${value.slice(8)}`;
  }
  if (value.length === 13 && value.startsWith("55")) {
    return `+${value.slice(0, 2)} (${value.slice(2, 4)}) ${value.slice(4, 9)}-${value.slice(9)}`;
  }
  return value;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
  });
}

function displayNumber(
  number: string,
  labels: Record<string, string>,
  withPhone = false,
) {
  const label = labels[number];
  if (label && withPhone) return `${label} · ${formatPhone(number)}`;
  if (label) return label;
  return formatPhone(number);
}

function kindLabel(kind: InvoiceKind) {
  if (kind === "prepayment") return "Recarga";
  if (kind === "usage") return "Uso";
  return "Outro";
}

function detectPreset(from: string, to: string): PeriodPreset {
  if (!from && !to) return "all";
  const today = toIsoDate(new Date());
  if (from === startOfUtcMonth() && to === endOfUtcMonth()) return "month";
  if (from === monthsAgoUtc(2) && to === today) return "3m";
  if (from === startOfUtcYear() && to === today) return "ytd";
  return "custom";
}

export function Dashboard() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [whatsappNumbers, setWhatsappNumbers] = useState<string[]>([]);
  const [issueFrom, setIssueFrom] = useState("");
  const [issueTo, setIssueTo] = useState("");
  const [invoiceKind, setInvoiceKind] = useState<InvoiceKind | "all">("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [invoicePage, setInvoicePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  const currentFilters = useMemo(
    (): LoadFilters => ({
      whatsapp:
        !unassignedOnly && whatsappNumbers.length > 0
          ? whatsappNumbers
          : undefined,
      issueFrom: issueFrom || undefined,
      issueTo: issueTo || undefined,
      kind: invoiceKind === "all" ? undefined : invoiceKind,
      unassigned: unassignedOnly || undefined,
    }),
    [whatsappNumbers, issueFrom, issueTo, invoiceKind, unassignedOnly],
  );

  const load = useCallback(async (filters: LoadFilters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const number of filters.whatsapp ?? []) {
        params.append("whatsapp", number);
      }
      if (filters.issueFrom) params.set("issueFrom", filters.issueFrom);
      if (filters.issueTo) params.set("issueTo", filters.issueTo);
      if (filters.kind && filters.kind !== "all") params.set("kind", filters.kind);
      if (filters.unassigned) params.set("unassigned", "1");

      const res = await fetch(`/api/invoices?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Falha ao carregar faturas");
      }
      setData(json);
      setInvoicePage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(currentFilters);
  }, [load, currentFilters]);

  function applyPeriod(preset: PeriodPreset) {
    setPeriodPreset(preset);
    const today = toIsoDate(new Date());
    if (preset === "all") {
      setIssueFrom("");
      setIssueTo("");
      return;
    }
    if (preset === "month") {
      setIssueFrom(startOfUtcMonth());
      setIssueTo(endOfUtcMonth());
      return;
    }
    if (preset === "3m") {
      setIssueFrom(monthsAgoUtc(2));
      setIssueTo(today);
      return;
    }
    if (preset === "ytd") {
      setIssueFrom(startOfUtcYear());
      setIssueTo(today);
    }
  }

  function clearFilters() {
    setWhatsappNumbers([]);
    setIssueFrom("");
    setIssueTo("");
    setInvoiceKind("all");
    setUnassignedOnly(false);
    setPeriodPreset("all");
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = (await res.json()) as SyncResult & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Falha na sincronização");
      }
      setSyncMessage(describeResult(json, "e-mail(s) analisado(s)"));
      if (json.errors.length > 0) {
        setError(json.errors.slice(0, 3).join(" | "));
      }
      await load(currentFilters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  function describeResult(json: SyncResult, processedLabel: string) {
    const parts = [
      `${json.processed} ${processedLabel}`,
      `${json.imported} importado(s)`,
      `${json.skipped} ignorado(s)`,
    ];
    if (json.errors.length > 0) {
      parts.push(`${json.errors.length} aviso(s)`);
    }
    return parts.join(" · ");
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const number of currentFilters.whatsapp ?? []) {
        params.append("whatsapp", number);
      }
      if (currentFilters.issueFrom) params.set("issueFrom", currentFilters.issueFrom);
      if (currentFilters.issueTo) params.set("issueTo", currentFilters.issueTo);
      if (currentFilters.kind) params.set("kind", currentFilters.kind);
      if (currentFilters.unassigned) params.set("unassigned", "1");
      const res = await fetch(`/api/invoices/export?${params.toString()}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error || "Falha ao exportar planilha");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "invoice360.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao exportar");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFiles(files: FileList | null) {
    const selected = [...(files ?? [])];
    if (selected.length === 0) return;
    setImporting(true);
    setSyncMessage(null);
    setError(null);
    try {
      const body = new FormData();
      for (const file of selected) body.append("file", file);
      const res = await fetch("/api/invoices/import", {
        method: "POST",
        body,
      });
      const json = (await res.json()) as SyncResult & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Falha ao importar PDFs");
      }
      setSyncMessage(describeResult(json, "PDF(s)"));
      if (json.errors.length > 0) {
        setError(json.errors.slice(0, 3).join(" | "));
      }
      await load(currentFilters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao importar PDFs");
    } finally {
      setImporting(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }

  async function handleSaveLabel(number: string) {
    setSavingLabel(true);
    setError(null);
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whatsappNumber: number,
          displayName: labelDraft,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Falha ao salvar apelido");
      }
      setEditingLabel(null);
      setLabelDraft("");
      await load(currentFilters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar apelido");
    } finally {
      setSavingLabel(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  function startEditLabel(number: string) {
    setEditingLabel(number);
    setLabelDraft(data?.labels[number] ?? "");
  }

  function toggleWhatsappNumber(number: string) {
    setUnassignedOnly(false);
    setWhatsappNumbers((current) =>
      current.includes(number)
        ? current.filter((item) => item !== number)
        : [...current, number],
    );
  }

  const labels = data?.labels ?? {};
  const stats = data?.stats;
  const monthly = data?.monthly ?? [];
  const invoices = data?.invoices ?? [];
  const summary = data?.summary ?? [];
  const unassigned = data?.unassigned;
  const accountEmails = [
    ...new Set(
      summary
        .map((row) => row.customerEmail)
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const hasActiveFilters = Boolean(
    whatsappNumbers.length > 0 ||
      issueFrom ||
      issueTo ||
      invoiceKind !== "all" ||
      unassignedOnly,
  );
  const moneyCurrency =
    stats?.currencyTotals.length === 1
      ? stats.currencyTotals[0]?.currency
      : (summary[0]?.currency ?? "USD");

  const usageByNumber = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of summary) {
      map.set(row.whatsappNumber, row.usageAmount);
    }
    return map;
  }, [summary]);

  const filterChips = useMemo(() => {
    const chips: string[] = [];
    if (periodPreset === "month") chips.push("Este mês");
    else if (periodPreset === "3m") chips.push("Últimos 3 meses");
    else if (periodPreset === "ytd") chips.push("Ano atual");
    else if (issueFrom || issueTo) {
      chips.push(
        `${formatDate(issueFrom || null)} → ${formatDate(issueTo || null)}`,
      );
    }
    if (invoiceKind === "usage") chips.push("Tipo: uso");
    if (invoiceKind === "prepayment") chips.push("Tipo: recarga");
    if (invoiceKind === "other") chips.push("Tipo: outro");
    if (unassignedOnly) chips.push("Sem número");
    else if (whatsappNumbers.length > 0) {
      chips.push(
        whatsappNumbers.length === 1
          ? displayNumber(whatsappNumbers[0], labels, true)
          : `${whatsappNumbers.length} números`,
      );
    }
    return chips;
  }, [
    periodPreset,
    issueFrom,
    issueTo,
    invoiceKind,
    unassignedOnly,
    whatsappNumbers,
    labels,
  ]);

  const pageCount = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
  const pageInvoices = invoices.slice(
    (invoicePage - 1) * PAGE_SIZE,
    invoicePage * PAGE_SIZE,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-wide text-teal-800/80 uppercase">
            Invoice360
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">
            Faturas WhatsApp
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">
            Importe as faturas da conta logada no Hub da 360dialog, ou
            sincronize os e-mails cujo assunto contém &quot;Your 360dialog
            invoice&quot;.
          </p>
          {accountEmails.length > 0 && (
            <p className="mt-2 text-sm text-zinc-800">
              E-mail da conta:{" "}
              <span className="font-medium">{accountEmails.join(", ")}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              disabled={importing}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-800 px-5 text-sm font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? "Importando PDFs…" : "Importar PDFs"}
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || loading}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "Exportando…" : "Exportar Excel"}
            </button>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing ? "Sincronizando…" : "Sincronizar e-mails"}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              Sair
            </button>
          </div>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleImportFiles(event.target.files);
            }}
          />
          <a
            href="/360dialog-import.user.js"
            className="max-w-sm text-right text-xs text-teal-800 hover:underline"
          >
            Instalar script do Hub — abra as faturas logado e clique em Enviar
            ao Invoice360
          </a>
        </div>
      </header>

      {(syncMessage || error) && (
        <div className="space-y-2">
          {syncMessage && (
            <p className="rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-900">
              {syncMessage}
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "Tudo"],
              ["month", "Este mês"],
              ["3m", "Últimos 3 meses"],
              ["ytd", "Ano atual"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPeriod(key)}
              className={`h-9 rounded-lg px-3 text-sm transition ${
                periodPreset === key
                  ? "bg-teal-800 text-white"
                  : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {label}
            </button>
          ))}
          <select
            value={invoiceKind}
            onChange={(event) =>
              setInvoiceKind(event.target.value as InvoiceKind | "all")
            }
            className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-teal-700"
          >
            <option value="all">Todos os tipos</option>
            <option value="usage">Uso / fechamento</option>
            <option value="prepayment">Recarga</option>
            <option value="other">Outros</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setUnassignedOnly((current) => !current);
              if (!unassignedOnly) setWhatsappNumbers([]);
            }}
            className={`h-9 rounded-lg px-3 text-sm transition ${
              unassignedOnly
                ? "bg-amber-700 text-white"
                : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            Sem número
            {stats && stats.unassignedInvoiceCount > 0
              ? ` (${stats.unassignedInvoiceCount})`
              : ""}
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex w-full shrink-0 flex-col gap-1 text-sm text-zinc-700 lg:w-80">
            <div className="flex items-center justify-between gap-2">
              <span>Filtrar por número</span>
              {whatsappNumbers.length > 0 && (
                <span className="text-xs text-zinc-500">
                  {whatsappNumbers.length} selecionado(s)
                </span>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2">
              {(data?.numbers ?? []).length === 0 ? (
                <p className="text-xs text-zinc-500">Nenhum número disponível</p>
              ) : (
                <ul className="space-y-1.5">
                  {(data?.numbers ?? []).map((n) => {
                    const checked = whatsappNumbers.includes(n);
                    const usage = usageByNumber.get(n);
                    return (
                      <li key={n}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={unassignedOnly}
                            onChange={() => toggleWhatsappNumber(n)}
                            className="mt-0.5 accent-teal-800"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {displayNumber(n, labels, true)}
                            </span>
                            {usage != null && (
                              <span className="text-xs text-zinc-500">
                                Uso: {formatMoney(usage, moneyCurrency)}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Nenhum marcado = todos os números.
            </p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm text-zinc-700">
              Emissão de
              <input
                type="date"
                value={issueFrom}
                onChange={(e) => {
                  setIssueFrom(e.target.value);
                  setPeriodPreset(
                    detectPreset(e.target.value, issueTo),
                  );
                }}
                className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-teal-700"
              />
            </label>
            <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm text-zinc-700">
              Emissão até
              <input
                type="date"
                value={issueTo}
                onChange={(e) => {
                  setIssueTo(e.target.value);
                  setPeriodPreset(
                    detectPreset(issueFrom, e.target.value),
                  );
                }}
                className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-teal-700"
              />
            </label>
          </div>
        </div>

        {filterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Uso WhatsApp"
          value={formatMoney(stats?.usageAmount ?? 0, moneyCurrency)}
          hint="Custo econômico do período"
          emphasize
        />
        <StatCard
          label="Taxas"
          value={formatMoney(stats?.feeAmount ?? 0, moneyCurrency)}
          hint={`Taxa efetiva ${formatPct(stats?.feeRate)}`}
        />
        <StatCard
          label={hasActiveFilters ? "Caixa filtrado" : "Caixa pago"}
          value={formatMoney(stats?.totalAmount ?? 0, moneyCurrency)}
          hint="Valor cobrado nas faturas"
        />
        <StatCard
          label="Δ Uso vs período anterior"
          value={
            stats?.usageDelta == null
              ? "—"
              : formatMoney(stats.usageDelta, moneyCurrency)
          }
          hint={
            stats?.usageDeltaPct == null
              ? "Defina um intervalo de datas"
              : formatPct(stats.usageDeltaPct)
          }
          tone={
            stats?.usageDelta == null
              ? "neutral"
              : stats.usageDelta > 0
                ? "up"
                : stats.usageDelta < 0
                  ? "down"
                  : "neutral"
          }
        />
        <StatCard
          label="Faturas"
          value={String(stats?.invoiceCount ?? 0)}
          hint={`${stats?.whatsappCount ?? 0} números`}
        />
      </section>
      <p className="-mt-4 text-xs text-zinc-500">
        Uso é a métrica de custo do WhatsApp. Caixa é o valor cobrado; fechamento
        quitado com crédito fica zerado no caixa.
      </p>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-800 uppercase">
          Evolução mensal
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : monthly.length === 0 ? (
          <EmptyState text="Sem dados mensais para os filtros selecionados." />
        ) : (
          <MonthlyBarChart data={monthly} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-800 uppercase">
          Ranking por número
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : summary.length === 0 && !unassigned ? (
          <EmptyState text="Nenhum resumo encontrado para os filtros selecionados." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Apelido</th>
                  <th className="px-4 py-3 font-medium">WhatsApp</th>
                  <th className="px-4 py-3 font-medium">Última emissão</th>
                  <th className="px-4 py-3 font-medium">Faturas</th>
                  <th className="px-4 py-3 font-medium">Uso</th>
                  <th className="px-4 py-3 font-medium">% Uso</th>
                  <th className="px-4 py-3 font-medium">Taxa</th>
                  <th className="px-4 py-3 font-medium">Média uso</th>
                  <th className="px-4 py-3 font-medium">Caixa</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr
                    key={`${row.whatsappNumber}-${row.currency}`}
                    className="border-t border-zinc-100 align-top"
                  >
                    <td className="px-4 py-3">
                      {editingLabel === row.whatsappNumber ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="text"
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            placeholder="Ex.: CSP BH"
                            className="h-9 min-w-[140px] rounded-lg border border-zinc-300 px-2 text-sm outline-none focus:border-teal-700"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={savingLabel}
                              onClick={() =>
                                void handleSaveLabel(row.whatsappNumber)
                              }
                              className="text-sm font-medium text-teal-800 hover:underline disabled:opacity-50"
                            >
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLabel(null);
                                setLabelDraft("");
                              }}
                              className="text-sm text-zinc-500 hover:underline"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-zinc-900">
                            {row.displayName ?? "—"}
                          </span>
                          <button
                            type="button"
                            onClick={() => startEditLabel(row.whatsappNumber)}
                            className="text-xs text-teal-800 hover:underline"
                          >
                            {row.displayName ? "Editar" : "Definir"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      <button
                        type="button"
                        className="text-teal-800 hover:underline"
                        onClick={() => toggleWhatsappNumber(row.whatsappNumber)}
                      >
                        {formatPhone(row.whatsappNumber)}
                      </button>
                      <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className="h-full rounded-full bg-teal-700"
                          style={{
                            width: `${Math.max(row.usageShare * 100, 2)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatDate(row.latestIssueDate)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {row.invoiceCount}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatMoney(row.usageAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatPct(row.usageShare)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatMoney(row.feeAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatMoney(row.averageUsageAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {formatMoney(row.totalAmount, row.currency)}
                    </td>
                  </tr>
                ))}
                {unassigned && (
                  <tr className="border-t border-amber-100 bg-amber-50/60 align-top">
                    <td className="px-4 py-3 font-medium text-amber-950">
                      Sem número
                    </td>
                    <td className="px-4 py-3 text-amber-900">
                      <button
                        type="button"
                        className="text-amber-900 underline"
                        onClick={() => {
                          setUnassignedOnly(true);
                          setWhatsappNumbers([]);
                        }}
                      >
                        Ver faturas sem telefone
                      </button>
                    </td>
                    <td className="px-4 py-3 text-amber-900">—</td>
                    <td className="px-4 py-3 text-amber-900">
                      {unassigned.invoiceCount}
                    </td>
                    <td className="px-4 py-3 text-amber-900">
                      {formatMoney(unassigned.usageAmount, unassigned.currency)}
                    </td>
                    <td className="px-4 py-3 text-amber-900">—</td>
                    <td className="px-4 py-3 text-amber-900">
                      {formatMoney(unassigned.feeAmount, unassigned.currency)}
                    </td>
                    <td className="px-4 py-3 text-amber-900">—</td>
                    <td className="px-4 py-3 text-amber-950">
                      {formatMoney(unassigned.totalAmount, unassigned.currency)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-800 uppercase">
            Faturas
          </h2>
          {!loading && invoices.length > 0 && (
            <p className="text-xs text-zinc-500">
              {invoices.length} fatura(s) · página {invoicePage} de {pageCount}
            </p>
          )}
        </div>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : invoices.length === 0 ? (
          <EmptyState text="Nenhuma fatura encontrada para os filtros selecionados." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Fatura</th>
                    <th className="px-4 py-3 font-medium">Emissão</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">WhatsApp</th>
                    <th className="px-4 py-3 font-medium">Uso</th>
                    <th className="px-4 py-3 font-medium">Taxa</th>
                    <th className="px-4 py-3 font-medium">Caixa</th>
                    <th className="px-4 py-3 font-medium">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {pageInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="border-t border-zinc-100 align-top"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {invoice.invoiceNumber}
                        {invoice.settledWithCredit && (
                          <span className="mt-1 block text-[11px] font-normal text-amber-800">
                            Quitada com crédito
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatDate(invoice.issueDate)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {kindLabel(invoice.invoiceKind)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {invoice.whatsappNumber
                          ? displayNumber(invoice.whatsappNumber, labels, true)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatMoney(invoice.usageAmount, invoice.currency)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatMoney(invoice.feeAmount, invoice.currency)}
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        {formatMoney(invoice.total, invoice.currency)}
                      </td>
                      <td className="px-4 py-3">
                        {invoice.hasPdf ? (
                          <a
                            href={`/api/invoices/file?id=${invoice.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-teal-800 hover:underline"
                          >
                            Abrir
                          </a>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={invoicePage <= 1}
                  onClick={() => setInvoicePage((page) => Math.max(1, page - 1))}
                  className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700 disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={invoicePage >= pageCount}
                  onClick={() =>
                    setInvoicePage((page) => Math.min(pageCount, page + 1))
                  }
                  className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700 disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <p className="text-sm text-zinc-600">{text}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  emphasize = false,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
  tone?: "neutral" | "up" | "down";
}) {
  const valueClass =
    tone === "up"
      ? "text-amber-800"
      : tone === "down"
        ? "text-teal-800"
        : "text-zinc-900";
  return (
    <div
      className={`rounded-xl border px-4 py-4 ${
        emphasize
          ? "border-teal-200 bg-teal-50/70"
          : "border-zinc-200 bg-white"
      }`}
    >
      <p className="text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function MonthlyBarChart({ data }: { data: MonthlySummary[] }) {
  const byMonth = new Map<
    string,
    {
      month: string;
      usageAmount: number;
      totalAmount: number;
      invoiceCount: number;
      currency: string;
    }
  >();
  for (const item of data) {
    const current = byMonth.get(item.month);
    if (current) {
      current.usageAmount += item.usageAmount;
      current.totalAmount += item.totalAmount;
      current.invoiceCount += item.invoiceCount;
    } else {
      byMonth.set(item.month, {
        month: item.month,
        usageAmount: item.usageAmount,
        totalAmount: item.totalAmount,
        invoiceCount: item.invoiceCount,
        currency: item.currency,
      });
    }
  }
  const series = [...byMonth.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const maxAmount = Math.max(
    ...series.flatMap((d) => [d.usageAmount, d.totalAmount]),
    1,
  );
  const currency = series[0]?.currency ?? "USD";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-zinc-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-teal-700" />
          Uso
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-400" />
          Caixa pago
        </span>
      </div>
      <div className="flex h-64 items-end gap-2 overflow-x-auto sm:gap-3">
        {series.map((item) => {
          const usageHeight = Math.max((item.usageAmount / maxAmount) * 100, 2);
          const cashHeight = Math.max((item.totalAmount / maxAmount) * 100, 2);
          return (
            <div
              key={item.month}
              className="flex h-full min-w-[3.5rem] flex-1 flex-col items-center sm:min-w-[4.25rem]"
              title={`${formatMonthLabel(item.month)} · uso ${formatMoney(item.usageAmount, currency)} · caixa ${formatMoney(item.totalAmount, currency)} · ${item.invoiceCount} fatura(s)`}
            >
              <div className="flex min-h-0 w-full flex-1 items-end justify-center gap-1">
                <div className="flex h-full w-[42%] flex-col items-center justify-end">
                  <span className="mb-1 text-[9px] font-medium leading-none text-teal-900">
                    {formatMoney(item.usageAmount, currency)}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-teal-700"
                    style={{ height: `${usageHeight}%` }}
                  />
                </div>
                <div className="flex h-full w-[42%] flex-col items-center justify-end">
                  <span className="mb-1 text-[9px] font-medium leading-none text-zinc-600">
                    {formatMoney(item.totalAmount, currency)}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-zinc-400"
                    style={{ height: `${cashHeight}%` }}
                  />
                </div>
              </div>
              <span className="mt-2 w-full truncate text-center text-[11px] capitalize text-zinc-600">
                {formatMonthLabel(item.month)}
              </span>
              <span className="text-[10px] text-zinc-400">
                {item.invoiceCount} fat.
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Uso mostra o custo WhatsApp; caixa mostra o valor cobrado no mês.
      </p>
    </div>
  );
}
