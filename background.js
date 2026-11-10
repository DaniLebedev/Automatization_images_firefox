(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const CVAT_PATTERN = /\/(tasks|jobs|task|job)\/\d+/i;
  const VERSION = "0.1.6";
  const SETTINGS_KEY = "fo:settings";
  const DEFAULT_LMSTUDIO = "http://localhost:1234/v1";
  const VISION_HINTS = ["vl", "vision", "llava", "internvl", "gemma-3", "minicpm-v"];

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

  async function analyzeIngredients(imageDataUrl) {
    const data = await api.storage.local.get(SETTINGS_KEY);
    const settings = data[SETTINGS_KEY] || {};
    const baseUrl = String(settings.lmStudioUrl || DEFAULT_LMSTUDIO).replace(/\/+$/, "");
    let model = String(settings.lmStudioModel || "").trim();
    if (!model) {
      const modelsResponse = await fetch(`${baseUrl}/models`);
      if (!modelsResponse.ok) {
        throw new Error(`LM Studio /models: HTTP ${modelsResponse.status}`);
      }
      const modelsPayload = await modelsResponse.json();
      const models = (modelsPayload.data || [])
        .map((item) => String(item.id || ""))
        .filter(Boolean);
      model =
        models.find((id) =>
          VISION_HINTS.some((hint) => id.toLowerCase().includes(hint))
        ) || models[0] || "";
      if (!model) {
        throw new Error("В LM Studio не загружена модель");
      }
    }
    const prompt =
      "List every visible edible ingredient in this food photo. " +
      "Use common English names (fish, potato, lemon, mayonnaise, ketchup, lettuce...). " +
      "Exclude plates, people, hands, tables, napkins, cutlery and background. " +
      'Return ONLY JSON: {"ingredients":["fish","potato","lemon"]}';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0.0,
        max_tokens: 400,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`LM Studio: HTTP ${response.status}`);
    }
    const payload = await response.json();
    const content = payload.choices && payload.choices[0] &&
      payload.choices[0].message && payload.choices[0].message.content;
    return {
      ingredients: parseIngredients(content),
      model,
      raw: String(content || ""),
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
