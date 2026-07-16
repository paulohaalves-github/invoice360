"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  InvoiceSummaryByNumber,
  MonthlySummary,
  SyncResult,
} from "@/lib/types";

type LoadFilters = {
  whatsapp?: string[];
  issueFrom?: string;
  issueTo?: string;
};

type ApiPayload = {
  numbers: string[];
  summary: InvoiceSummaryByNumber[];
  monthly: MonthlySummary[];
  stats: {
    invoiceCount: number;
    totalAmount: number;
    emailCount: number;
    whatsappCount: number;
  };
  labels: Record<string, string>;
};

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
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

export function Dashboard() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [whatsappNumbers, setWhatsappNumbers] = useState<string[]>([]);
  const [issueFrom, setIssueFrom] = useState("");
  const [issueTo, setIssueTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  const currentFilters = useMemo(
    (): LoadFilters => ({
      whatsapp: whatsappNumbers.length > 0 ? whatsappNumbers : undefined,
      issueFrom: issueFrom || undefined,
      issueTo: issueTo || undefined,
    }),
    [whatsappNumbers, issueFrom, issueTo],
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

      const res = await fetch(`/api/invoices?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Falha ao carregar faturas");
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(currentFilters);
  }, [load, currentFilters]);

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
      const parts = [
        `${json.processed} e-mail(s) analisado(s)`,
        `${json.imported} importado(s)`,
        `${json.skipped} ignorado(s)`,
      ];
      if (json.errors.length > 0) {
        parts.push(`${json.errors.length} aviso(s)`);
      }
      setSyncMessage(parts.join(" · "));
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

  function startEditLabel(number: string) {
    setEditingLabel(number);
    setLabelDraft(data?.labels[number] ?? "");
  }

  function toggleWhatsappNumber(number: string) {
    setWhatsappNumbers((current) =>
      current.includes(number)
        ? current.filter((item) => item !== number)
        : [...current, number],
    );
  }

  const labels = data?.labels ?? {};
  const stats = data?.stats;
  const monthly = data?.monthly ?? [];
  const hasActiveFilters = Boolean(
    whatsappNumbers.length > 0 || issueFrom || issueTo,
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
            Sincronize a caixa IMAP e importe e-mails cujo assunto contém
            &quot;Your 360dialog invoice&quot;, extraia o número do PDF e
            acompanhe os custos por linha WhatsApp.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-800 px-5 text-sm font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {syncing ? "Sincronizando…" : "Sincronizar e-mails"}
        </button>
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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Faturas" value={String(stats?.invoiceCount ?? 0)} />
        <StatCard
          label="Números WhatsApp"
          value={String(stats?.whatsappCount ?? 0)}
        />
        <StatCard
          label="E-mails processados"
          value={String(stats?.emailCount ?? 0)}
        />
        <StatCard
          label={hasActiveFilters ? "Total filtrado" : "Total geral"}
          value={formatMoney(stats?.totalAmount ?? 0)}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-1 text-sm text-zinc-700">
          <div className="flex items-center justify-between gap-2">
            <span>Filtrar por número</span>
            {whatsappNumbers.length > 0 && (
              <span className="text-xs text-zinc-500">
                {whatsappNumbers.length} selecionado(s)
              </span>
            )}
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-300 bg-white px-3 py-2">
            {(data?.numbers ?? []).length === 0 ? (
              <p className="text-xs text-zinc-500">Nenhum número disponível</p>
            ) : (
              <ul className="space-y-1.5">
                {(data?.numbers ?? []).map((n) => {
                  const checked = whatsappNumbers.includes(n);
                  return (
                    <li key={n}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWhatsappNumber(n)}
                          className="mt-0.5 accent-teal-800"
                        />
                        <span>{displayNumber(n, labels, true)}</span>
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

        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          Emissão de
          <input
            type="date"
            value={issueFrom}
            onChange={(e) => setIssueFrom(e.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-teal-700"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          Emissão até
          <input
            type="date"
            value={issueTo}
            onChange={(e) => setIssueTo(e.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-teal-700"
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setWhatsappNumbers([]);
              setIssueFrom("");
              setIssueTo("");
            }}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm text-zinc-700 transition hover:bg-zinc-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-800 uppercase">
          Evolução mensal
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : monthly.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-zinc-600">
              Sem dados mensais para os filtros selecionados.
            </p>
          </div>
        ) : (
          <MonthlyBarChart data={monthly} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-800 uppercase">
          Resumo por número
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : (data?.summary?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-zinc-600">
              Nenhum resumo encontrado para os filtros selecionados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Apelido</th>
                  <th className="px-4 py-3 font-medium">WhatsApp</th>
                  <th className="px-4 py-3 font-medium">Faturas</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data!.summary.map((row) => (
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
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {row.invoiceCount}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {formatMoney(row.totalAmount, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
      <p className="text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function MonthlyBarChart({ data }: { data: MonthlySummary[] }) {
  // Agrega por mês caso haja mais de uma moeda
  const byMonth = new Map<string, { month: string; totalAmount: number; invoiceCount: number; currency: string }>();
  for (const item of data) {
    const current = byMonth.get(item.month);
    if (current) {
      current.totalAmount += item.totalAmount;
      current.invoiceCount += item.invoiceCount;
    } else {
      byMonth.set(item.month, {
        month: item.month,
        totalAmount: item.totalAmount,
        invoiceCount: item.invoiceCount,
        currency: item.currency,
      });
    }
  }
  const series = [...byMonth.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const maxAmount = Math.max(...series.map((d) => d.totalAmount), 1);
  const currency = series[0]?.currency ?? "USD";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex h-64 items-end gap-2 overflow-x-auto sm:gap-3">
        {series.map((item) => {
          const heightPct = Math.max((item.totalAmount / maxAmount) * 100, 3);
          return (
            <div
              key={item.month}
              className="flex h-full min-w-[3.25rem] flex-1 flex-col items-center sm:min-w-[4rem]"
              title={`${formatMonthLabel(item.month)}: ${formatMoney(item.totalAmount, item.currency)} · ${item.invoiceCount} fatura(s)`}
            >
              <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-[10px] font-medium leading-none text-zinc-700 sm:text-[11px]">
                  {formatMoney(item.totalAmount, currency)}
                </span>
                <div
                  className="w-full max-w-16 rounded-t-md bg-teal-700"
                  style={{ height: `${heightPct}%` }}
                />
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
        Evolução mensal do valor total das faturas (por data de emissão).
      </p>
    </div>
  );
}
