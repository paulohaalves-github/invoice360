// ==UserScript==
// @name         Invoice360 — faturas 360dialog
// @namespace    https://localhost/invoice360
// @version      1.0.0
// @description  Envia as faturas do Client Hub logado para o Invoice360 em localhost:3001
// @match        https://app.360dialog.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const INVOICE360_ORIGINS = ["http://127.0.0.1:3001", "http://localhost:3001"];
  const TOKEN_URL = "https://authx360-hub.360dialog.com/token";
  const nativeFetch = window.fetch.bind(window);

  const session = {
    authorization: null,
    listUrl: null,
  };

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function headerValue(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    const target = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target) return headers[key];
    }
    return null;
  }

  function isInvoiceListUrl(url) {
    try {
      const path = new URL(url, location.origin).pathname;
      return /\/partners\/[^/]+\/clients\/[^/]+\/invoices\/?$/.test(path);
    } catch {
      return false;
    }
  }

  window.fetch = async function (input, init) {
    const url = requestUrl(input);
    const auth =
      headerValue(init && init.headers, "authorization") ||
      (input && typeof input !== "string" && !(input instanceof URL)
        ? headerValue(input.headers, "authorization")
        : null);
    if (auth && /hub\.360dialog\.io/i.test(url)) {
      session.authorization = auth;
    }
    if (isInvoiceListUrl(url)) {
      session.listUrl = url;
    }
    return nativeFetch(input, init);
  };

  function invoiceIds(item) {
    const values = [
      item && item.id,
      item && item.invoice_id,
      item && item.invoiceId,
      item && item.bill_number,
      item && item.billNumber,
      item && item.number,
      item && item.invoice_number,
    ];
    return [
      ...new Set(
        values
          .filter((value) => value != null && String(value).trim())
          .map((value) => String(value).trim()),
      ),
    ];
  }

  function extractItems(json) {
    if (Array.isArray(json)) return json;
    if (Array.isArray(json && json.data)) return json.data;
    if (Array.isArray(json && json.invoices)) return json.invoices;
    if (Array.isArray(json && json.items)) return json.items;
    return [];
  }

  function pdfUrl(listUrl, invoiceId) {
    const url = new URL(listUrl, location.origin);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(
      /\/invoices\/?$/,
      `/invoice/${encodeURIComponent(invoiceId)}/pdf`,
    );
    return url.toString();
  }

  async function freshAuthorization() {
    try {
      const response = await nativeFetch(TOKEN_URL, {
        method: "HEAD",
        credentials: "include",
      });
      const token = response.headers.get("X-Authx360-Access-Token");
      if (response.ok && token) return `Bearer ${token}`;
    } catch {
      // A sessão capturada da própria página continua válida.
    }
    return session.authorization;
  }

  async function listInvoices(listUrl, authorization) {
    const items = [];
    const seen = new Set();
    for (let page = 1; page <= 50; page += 1) {
      const url = new URL(listUrl, location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", "100");
      const response = await nativeFetch(url, {
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Lista de faturas respondeu HTTP ${response.status}`);
      }
      const json = await response.json();
      const batch = extractItems(json);
      for (const item of batch) {
        const key = invoiceIds(item)[0];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
      const totalPages =
        (json && json.pagination && json.pagination.total_pages) ||
        (json && json.total_pages) ||
        0;
      if (totalPages && page >= totalPages) break;
      if (batch.length < 100) break;
    }
    return items;
  }

  async function downloadPdf(listUrl, item, authorization) {
    const ids = invoiceIds(item);
    if (ids.length === 0) {
      throw new Error("Fatura sem identificador");
    }
    let lastStatus = 0;
    for (const id of ids) {
      const response = await nativeFetch(pdfUrl(listUrl, id), {
        headers: { Authorization: authorization, Accept: "*/*" },
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const signature = String.fromCharCode(...bytes.subarray(0, 4));
      if (signature !== "%PDF") continue;
      const label = ids.find((value) => /^INV/i.test(value)) || id;
      return { name: `${label}.pdf`, buffer };
    }
    throw new Error(`PDF ${ids[0]}: HTTP ${lastStatus}`);
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const size = 0x8000;
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size));
    }
    return btoa(binary);
  }

  async function invoice360Origin() {
    for (const origin of INVOICE360_ORIGINS) {
      try {
        const response = await nativeFetch(`${origin}/api/invoices/import`, {
          method: "GET",
        });
        if (response.ok) return origin;
      } catch {
        // Tenta o próximo endereço local.
      }
    }
    throw new Error(
      "Invoice360 não respondeu em localhost:3001. Deixe npm run dev aberto.",
    );
  }

  async function postPdf(origin, file) {
    const response = await nativeFetch(`${origin}/api/invoices/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        dataBase64: bytesToBase64(file.buffer),
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json.error || `Invoice360 respondeu HTTP ${response.status}`);
    }
    return json;
  }

  function onInvoicesPage() {
    return /\/client\/[^/]+\/invoices\/?$/.test(location.pathname);
  }

  let root = null;
  let statusNode = null;
  let button = null;

  function setStatus(text) {
    if (statusNode) statusNode.textContent = text;
  }

  async function sendInvoices() {
    if (!session.listUrl) {
      setStatus(
        "A lista ainda não passou pela página. Recarregue esta aba de faturas e clique de novo.",
      );
      return;
    }
    if (button) button.disabled = true;
    try {
      setStatus("Lendo a sessão do Hub…");
      const authorization = await freshAuthorization();
      if (!authorization) {
        throw new Error("Sessão do Hub indisponível. Entre de novo e recarregue.");
      }
      setStatus("Buscando faturas…");
      const items = await listInvoices(session.listUrl, authorization);
      if (items.length === 0) {
        setStatus("Nenhuma fatura encontrada nesta conta.");
        return;
      }
      const origin = await invoice360Origin();
      let imported = 0;
      let skipped = 0;
      const errors = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setStatus(`Baixando ${index + 1} de ${items.length}…`);
        try {
          const file = await downloadPdf(session.listUrl, item, authorization);
          const result = await postPdf(origin, file);
          imported += result.imported || 0;
          skipped += result.skipped || 0;
          if (result.errors && result.errors.length) errors.push(...result.errors);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const parts = [
        `${imported} importada(s)`,
        `${skipped} já existente(s)`,
      ];
      if (errors.length) parts.push(`${errors.length} aviso(s)`);
      setStatus(parts.join(" · "));
      if (errors.length) {
        setStatus(`${parts.join(" · ")} — ${errors.slice(0, 2).join(" | ")}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao enviar");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function mount() {
    if (root || !document.body) return;
    root = document.createElement("div");
    root.id = "invoice360-hub-import";
    root.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:280px",
      "padding:12px",
      "border-radius:12px",
      "background:#ffffff",
      "color:#18181b",
      "box-shadow:0 10px 30px rgba(0,0,0,.18)",
      "font:13px/1.4 Segoe UI,sans-serif",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Invoice360";
    title.style.cssText = "font-weight:650;margin-bottom:4px;color:#115e59";

    const hint = document.createElement("div");
    hint.textContent =
      "Envia as faturas desta conta logada para o Invoice360 local.";
    hint.style.cssText = "color:#52525b;margin-bottom:8px";

    button = document.createElement("button");
    button.type = "button";
    button.textContent = "Enviar ao Invoice360";
    button.style.cssText = [
      "width:100%",
      "height:36px",
      "border:0",
      "border-radius:8px",
      "background:#115e59",
      "color:#fff",
      "font:inherit",
      "font-weight:600",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", () => {
      void sendInvoices();
    });

    statusNode = document.createElement("div");
    statusNode.style.cssText = "margin-top:8px;color:#3f3f46;min-height:1.2em";

    root.append(title, hint, button, statusNode);
    document.body.append(root);
  }

  function unmount() {
    root?.remove();
    root = null;
    button = null;
    statusNode = null;
  }

  function syncPanel() {
    if (onInvoicesPage()) mount();
    else unmount();
  }

  const pushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    const result = pushState(...args);
    syncPanel();
    return result;
  };
  window.addEventListener("popstate", syncPanel);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncPanel, { once: true });
  } else {
    syncPanel();
  }
})();
