(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const CVAT_PATTERN = /\/(tasks|jobs|task|job)\/\d+/i;
  const VERSION = "0.1.8";
  const SETTINGS_KEY = "fo:settings";
  const CONFIG_FILE = "config.local.json";
  const REQUEST_TIMEOUT_MS = 90_000;
  const VISION_HINTS = ["vl", "vision", "llava", "internvl", "gemma-3", "minicpm-v"];

  const library = globalThis.FoodOutlineLib;
  if (!library) {
    console.error("Food Outline: src/lib.js is not loaded before background.js");
  }

  function parseIngredients(text) {
    let cleaned = String(text || "").trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const match = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    let payload = null;
    if (match) {
      try {
        payload = JSON.parse(match[0]);
      } catch (_error) {
        payload = null;
      }
    }
    let items = [];
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && Array.isArray(payload.ingredients)) {
      items = payload.ingredients;
    } else if (payload && Array.isArray(payload.items)) {
      items = payload.items;
    } else {
      items = cleaned
        .split(/[\n,;]+/)
        .map((item) => item.replace(/^[-*•\d.\s]+/, "").trim());
    }
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const value = String(
        typeof item === "string" ? item : item && item.name ? item.name : ""
      )
        .trim()
        .toLowerCase();
      if (!value || value.length > 60 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result.slice(0, 30);
  }

  function messageText(content) {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          return part && typeof part.text === "string" ? part.text : "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  async function loadLocalConfig() {
    try {
      const response = await fetch(api.runtime.getURL(CONFIG_FILE), {
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      return payload && typeof payload === "object" ? payload : null;
    } catch (_error) {
      return null;
    }
  }

  async function readAiConfig() {
    if (!library) {
      throw new Error("src/lib.js is not loaded");
    }
    const data = await api.storage.local.get(SETTINGS_KEY);
    const settings = data[SETTINGS_KEY] || {};
    const localConfig = await loadLocalConfig();
    const config = library.resolveAiConfig(settings, localConfig);
    if (config.error) {
      throw new Error(config.error);
    }
    return config;
  }

  function publicAiConfig(config) {
    return {
      provider: config.provider,
      label: config.label,
      cloud: config.cloud,
      baseUrl: config.baseUrl,
      model: config.model,
      hasKey: config.hasKey,
      source: config.source,
    };
  }

  async function requestJson(url, options, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (_error) {
        payload = null;
      }
      if (!response.ok) {
        const rawDetail =
          payload && payload.error
            ? payload.error.message || payload.error
            : text;
        const detail = String(rawDetail || "").slice(0, 300);
        throw new Error(
          `${label}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`
        );
      }
      if (!payload) {
        throw new Error(`${label}: empty or invalid JSON response`);
      }
      return payload;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`${label}: timeout after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveLmStudioModel(config) {
    if (config.model) {
      return config.model;
    }
    const payload = await requestJson(
      `${config.baseUrl}/models`,
      { method: "GET" },
      "LM Studio"
    );
    const models = (payload.data || [])
      .map((item) => String(item.id || ""))
      .filter(Boolean);
    const model =
      models.find((id) =>
        VISION_HINTS.some((hint) => id.toLowerCase().includes(hint))
      ) || models[0] || "";
    if (!model) {
      throw new Error("В LM Studio не загружена модель");
    }
    return model;
  }

  function ingredientsPrompt() {
    return (
      "List every visible edible ingredient in this food photo. " +
      "Use common English names (fish, potato, lemon, mayonnaise, ketchup, lettuce...). " +
      "Exclude plates, people, hands, tables, napkins, cutlery and background. " +
      'Return ONLY JSON: {"ingredients":["fish","potato","lemon"]}'
    );
  }

  async function callVisionApi(config, model, imageDataUrl) {
    const headers = { "Content-Type": "application/json" };
    if (config.cloud && config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    if (config.provider === "openrouter") {
      headers["X-Title"] = "Food Outline Progress";
    }
    const payload = await requestJson(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: ingredientsPrompt() },
                { type: "image_url", image_url: { url: imageDataUrl } },
              ],
            },
          ],
          temperature: 0,
          max_tokens: 400,
          stream: false,
        }),
      },
      config.label
    );
    const choice = payload.choices && payload.choices[0];
    const content = choice && choice.message
      ? messageText(choice.message.content)
      : "";
    return {
      ingredients: parseIngredients(content),
      model,
      raw: content,
    };
  }

  async function analyzeIngredients(imageDataUrl) {
    const config = await readAiConfig();
    if (config.cloud && !config.hasKey) {
      throw new Error(
        `API-ключ не найден. Создайте ${CONFIG_FILE} по образцу config.example.json ` +
          "и вставьте ключ в поле apiKey. После этого нажмите F5 на странице CVAT."
      );
    }
    if (!config.model && config.provider !== "lmstudio") {
      throw new Error(`Для ${config.label} не задана модель`);
    }
    const model =
      config.provider === "lmstudio"
        ? await resolveLmStudioModel(config)
        : config.model;
    const result = await callVisionApi(config, model, imageDataUrl);
    return {
      ...result,
      provider: config.provider,
      label: config.label,
    };
  }

  async function inject(tabId) {
    try {
      await api.tabs.executeScript(tabId, { file: "src/lib.js" });
      await api.tabs.executeScript(tabId, { file: "src/content.js" });
    } catch (error) {
      console.warn("Food Outline injection failed", tabId, error);
    }
  }

  async function injectExistingTabs() {
    try {
      const tabs = await api.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && CVAT_PATTERN.test(tab.url)) {
          await inject(tab.id);
        }
      }
    } catch (_error) {
      // Ignore startup errors.
    }
  }

  api.runtime.onInstalled.addListener(() => {
    injectExistingTabs();
  });

  api.runtime.onStartup.addListener(() => {
    injectExistingTabs();
  });

  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) {
      return;
    }
    if (CVAT_PATTERN.test(tab.url)) {
      inject(tabId);
    }
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }
    if (message.type === "food-outline:version") {
      sendResponse({ ok: true, version: VERSION });
      return undefined;
    }
    if (message.type === "food-outline:ai-status") {
      readAiConfig()
        .then((config) => {
          sendResponse({ ok: true, ...publicAiConfig(config) });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: (error && error.message) || String(error),
          });
        });
      return true;
    }
    if (message.type === "food-outline:analyze") {
      analyzeIngredients(message.image)
        .then((result) => {
          sendResponse({ ok: true, ...result });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: (error && error.message) || String(error),
          });
        });
      return true;
    }
    return undefined;
  });

  injectExistingTabs();
})();
