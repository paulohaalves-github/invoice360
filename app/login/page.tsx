"use client";

import { FormEvent, useState } from "react";

function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(json?.error || "Não foi possível entrar.");
      }
      window.location.assign(nextPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-16">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <p className="text-sm font-medium tracking-wide text-teal-800/80 uppercase">
          Invoice360
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Entrar
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Use o usuário e a senha da conta para ver as faturas.
        </p>

        <label className="mt-6 flex flex-col gap-1 text-sm text-zinc-700">
          Usuário
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 rounded-lg border border-zinc-300 px-3 text-sm text-zinc-900 outline-none focus:border-teal-700"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm text-zinc-700">
          Senha
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 rounded-lg border border-zinc-300 px-3 text-sm text-zinc-900 outline-none focus:border-teal-700"
          />
        </label>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-teal-800 text-sm font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
