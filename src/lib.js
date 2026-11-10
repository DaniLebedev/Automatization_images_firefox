(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FoodOutlineLib = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ID_PARAMS = [
    "frame",
    "id",
    "image",
    "imageId",
    "card",
    "cardId",
    "item",
    "itemId",
  ];

  const FRAME_INPUT_SELECTORS = [
    'header input.ant-input-number-input[role="spinbutton"]',
    'header input.ant-input-number-input',
    'input.ant-input-number-input[aria-valuenow]',
    'input[role="spinbutton"][aria-valuenow]',
    'input[aria-label*="frame" i]',
    'input[name*="frame" i]',
    'input[id*="frame" i]',
    'input[class*="frame" i]',
    '[data-frame-number]',
    '[data-testid*="frame" i]',
  ];

  const FRAME_INPUT_XPATH =
    "/html/body/div[1]/div/main/div/header/div/div[2]/div/div[3]/div/div[2]/input";

  const AI_PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      cloud: true,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash",
    },
    groq: {
      label: "Groq",
      cloud: true,
      baseUrl: "https://api.groq.com/openai/v1",
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
    },
    openrouter: {
      label: "OpenRouter",
      cloud: true,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/free",
    },
    zai: {
      label: "Z.AI GLM",
      cloud: true,
      baseUrl: "https://api.z.ai/api/paas/v4",
      model: "glm-4.6v-flash",
    },
    lmstudio: {
      label: "LM Studio",
      cloud: false,
      baseUrl: "http://localhost:1234/v1",
      model: "",
    },
  };

  const AI_ALIASES = {
    google: "gemini",
    "google-gemini": "gemini",
    zhipu: "zai",
    "z.ai": "zai",
    local: "lmstudio",
  };

  function resolveAiConfig(settings, localConfig) {
    const safeSettings = settings || {};
    const safeLocal = localConfig || {};
    const explicitProvider = String(safeSettings.aiProvider || "")
      .trim()
      .toLowerCase();
    const fromSettings = Boolean(explicitProvider && explicitProvider !== "auto");
    let requested = explicitProvider;
    const configProvider = String(safeLocal.provider || "")
      .trim()
      .toLowerCase();
    if (!requested || requested === "auto") {
      requested = configProvider;
    }
    if (!requested) {
      requested = safeLocal.apiKey ? "gemini" : "lmstudio";
    }
    const name = AI_ALIASES[requested] || requested;
    const provider = AI_PROVIDERS[name];
    if (!provider) {
      return { error: `unknown AI provider: ${requested}`, provider: name };
    }
    const local = name === "lmstudio";
    const normalizedConfigProvider = AI_ALIASES[configProvider] || configProvider;
    const localModel =
      !fromSettings || normalizedConfigProvider === name ? safeLocal.model : "";
    const baseUrl = local
      ? safeSettings.lmStudioUrl || safeLocal.baseUrl || provider.baseUrl
      : safeLocal.baseUrl || provider.baseUrl;
    const model = local
      ? safeSettings.lmStudioModel || safeLocal.model || provider.model
      : safeSettings.aiModel || localModel || provider.model;
    const apiKey = String(safeLocal.apiKey || "").trim();
    return {
      provider: name,
      label: provider.label,
      cloud: provider.cloud,
      baseUrl: String(baseUrl || "").replace(/\/+$/, ""),
      model: String(model || "").trim(),
      apiKey,
      hasKey: Boolean(apiKey),
      source: apiKey
        ? "config.local.json"
        : local
          ? "LM Studio"
          : "API key missing",
    };
  }

  function findFrameInput(doc) {
    if (!doc || typeof doc.querySelector !== "function") {
      return null;
    }
    for (const selector of FRAME_INPUT_SELECTORS) {
      const element = doc.querySelector(selector);
      if (element) {
        return element;
      }
    }
    if (typeof doc.evaluate === "function") {
      try {
        const result = doc.evaluate(
          FRAME_INPUT_XPATH,
          doc,
          null,
          9,
          null
        );
        if (result && result.singleNodeValue) {
          return result.singleNodeValue;
        }
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function parseIdFromUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (_error) {
      return { id: null, source: "none", scope: "", param: null };
    }

    const hash = url.hash.replace(/^#/, "");
    const hashQueryIndex = hash.indexOf("?");
    const hashPath = hashQueryIndex >= 0 ? hash.slice(0, hashQueryIndex) : hash;
    const hashQuery = hashQueryIndex >= 0 ? hash.slice(hashQueryIndex + 1) : "";
    const scope = `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${
      hashPath ? `#${hashPath}` : ""
    }`;

    for (const param of ID_PARAMS) {
      const value = url.searchParams.get(param);
      if (value !== null && /^\d+$/.test(value)) {
        return { id: Number(value), source: `query:${param}`, scope, param };
      }
    }

    if (hashQuery) {
      const hashParams = new URLSearchParams(hashQuery);
      for (const param of ID_PARAMS) {
        const value = hashParams.get(param);
        if (value !== null && /^\d+$/.test(value)) {
          return { id: Number(value), source: `hash:${param}`, scope, param };
        }
      }
    }

    const pathMatch = hashPath.match(/(?:frame|image|item|card)[/=](\d+)/i);
    if (pathMatch) {
      return { id: Number(pathMatch[1]), source: "hash-path", scope, param: null };
    }

    return { id: null, source: "none", scope, param: null };
  }

  function parseIdFromDocument(doc) {
    if (!doc || typeof doc.querySelector !== "function") {
      return null;
    }
    const frameInput = findFrameInput(doc);
    if (frameInput) {
      const raw =
        frameInput.value ||
        frameInput.getAttribute("aria-valuenow") ||
        frameInput.getAttribute("value") ||
        frameInput.textContent ||
        "";
      const match = String(raw).match(/\d+/);
      if (match) {
        return Number(match[0]);
      }
    }
    for (const element of doc.querySelectorAll('input[type="number"]')) {
      const haystack = [
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.getAttribute("id"),
        element.getAttribute("class"),
        element.parentElement ? element.parentElement.textContent : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!/frame|кадр/.test(haystack)) {
        continue;
      }
      const match = String(element.value || "").match(/\d+/);
      if (match) {
        return Number(match[0]);
      }
    }
    for (const element of doc.querySelectorAll(
      '[class*="frame" i], [data-testid*="frame" i], [aria-label*="frame" i]'
    )) {
      const match = String(element.textContent || element.value || "").match(/\d+/);
      if (match) {
        return Number(match[0]);
      }
    }
    return null;
  }

  function normalizeRange(startValue, endValue) {
    const start = Number.parseInt(String(startValue ?? ""), 10);
    const end = Number.parseInt(String(endValue ?? ""), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { error: "Введите оба числа" };
    }
    if (start < 0 || end < 0) {
      return { error: "ID не может быть отрицательным" };
    }
    if (start > end) {
      return { error: "Начало должно быть меньше или равно концу" };
    }
    return { start, end, total: end - start + 1 };
  }

  function completedIds(completed, start, end) {
    const values = Array.isArray(completed)
      ? completed
      : Object.keys(completed || {});
    const ids = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= start && value <= end);
    return [...new Set(ids)].sort((left, right) => left - right);
  }

  function nextIncomplete(start, end, completed, current) {
    const done = new Set(completedIds(completed, start, end));
    if (current !== null && current >= start && current <= end) {
      for (let id = current + 1; id <= end; id += 1) {
        if (!done.has(id)) {
          return id;
        }
      }
      for (let id = start; id <= current; id += 1) {
        if (!done.has(id)) {
          return id;
        }
      }
      return null;
    }
    for (let id = start; id <= end; id += 1) {
      if (!done.has(id)) {
        return id;
      }
    }
    return null;
  }

  function computeStats(start, end, completed, current) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return {
        total: 0,
        done: 0,
        remaining: 0,
        percent: 0,
        currentDone: false,
        next: null,
        completedIds: [],
      };
    }
    const doneList = completedIds(completed, start, end);
    const total = end - start + 1;
    const done = doneList.length;
    return {
      total,
      done,
      remaining: Math.max(0, total - done),
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      currentDone: current !== null && doneList.includes(current),
      next: nextIncomplete(start, end, completed, current),
      completedIds: doneList,
    };
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return "—";
    }
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds} с`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
      return `${minutes}м ${String(seconds).padStart(2, "0")}с`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}ч ${String(minutes % 60).padStart(2, "0")}м`;
  }

  function formatEta(averageMs, remaining) {
    if (!Number.isFinite(averageMs) || averageMs <= 0 || remaining <= 0) {
      return "—";
    }
    return `~${formatDuration(averageMs * remaining)}`;
  }

  function isCvatLike(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (_error) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      host.includes("cvat") ||
      /\/tasks\/\d+/.test(path) ||
      /\/jobs\/\d+/.test(path) ||
      /\/task\/\d+/.test(path) ||
      /\/job\/\d+/.test(path) ||
      /[?&#]frame=/i.test(rawUrl) ||
      path.includes("/demo")
    );
  }

  function buildReport(scope, start, end, completed, timeSpentMs) {
    const stats = computeStats(start, end, completed, null);
    return {
      version: 1,
      scope,
      exportedAt: new Date().toISOString(),
      start,
      end,
      total: stats.total,
      completed: stats.done,
      remaining: stats.remaining,
      percent: stats.percent,
      completedIds: stats.completedIds,
      timeSpentMs: Math.max(0, Math.round(timeSpentMs || 0)),
    };
  }

  return {
    AI_PROVIDERS,
    ID_PARAMS,
    buildReport,
    completedIds,
    computeStats,
    findFrameInput,
    formatDuration,
    formatEta,
    isCvatLike,
    nextIncomplete,
    normalizeRange,
    parseIdFromDocument,
    parseIdFromUrl,
    resolveAiConfig,
  };
});
