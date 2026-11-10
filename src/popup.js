(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const elements = {
    current: document.getElementById("current-id"),
    range: document.getElementById("range"),
    progress: document.getElementById("progress"),
    bar: document.getElementById("bar"),
    status: document.getElementById("status"),
    open: document.getElementById("open-panel"),
    permission: document.getElementById("permission"),
    done: document.getElementById("done"),
    next: document.getElementById("next"),
    ingredients: document.getElementById("ingredients"),
    options: document.getElementById("options"),
  };

  let tab = null;

  function setStatus(text, isError) {
    elements.status.textContent = text;
    elements.status.style.color = isError ? "#ff9b9b" : "";
  }

  function isHttpUrl(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  function isCvatUrl(url) {
    if (typeof url !== "string") {
      return false;
    }
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.toLowerCase().includes("cvat") ||
        /\/(tasks|jobs|task|job)\/\d+/i.test(parsed.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  async function hasSitePermission() {
    if (!api.permissions || !api.permissions.contains) {
      return true;
    }
    try {
      return await api.permissions.contains({ origins: ["*://*/*"] });
    } catch (_error) {
      return true;
    }
  }

  function setPanelButtonsEnabled(enabled) {
    elements.open.disabled = !enabled;
    elements.done.disabled = !enabled;
    elements.next.disabled = !enabled;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function activeTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function sendRaw(tabId, type) {
    try {
      return await api.tabs.sendMessage(tabId, { type });
    } catch (_error) {
      return null;
    }
  }

  async function ensureContentScript(tabId) {
    const existing = await sendRaw(tabId, "food-outline:status");
    if (existing && existing.ok && existing.uiReady) {
      return existing;
    }
    try {
      await api.tabs.executeScript(tabId, { file: "src/lib.js" });
      await api.tabs.executeScript(tabId, { file: "src/content.js" });
      await sleep(400);
      const status = await sendRaw(tabId, "food-outline:status");
      return status || { ok: false, error: "content script did not respond" };
    } catch (error) {
      console.error("Food Outline injection failed", error);
      return {
        ok: false,
        error: (error && error.message) || String(error),
      };
    }
  }

  async function send(type) {
    if (!tab) {
      return { ok: false, error: "no active tab" };
    }
    const ensured = await ensureContentScript(tab.id);
    if (!ensured || !ensured.ok) {
      return ensured || { ok: false, error: "content script unavailable" };
    }
    return (await sendRaw(tab.id, type)) || { ok: false, error: "no response" };
  }

  function renderStatus(response) {
    if (!response || !response.ok) {
      setStatus(
        `Не удалось открыть панель: ${response && response.error ? response.error : "нет ответа"}. ` +
          "Обновите страницу (F5) и проверьте разрешения расширения.",
        true
      );
      setPanelButtonsEnabled(false);
      return;
    }
    setPanelButtonsEnabled(true);
    const stats = response.stats || {};
    elements.current.textContent = response.currentId === null ? "—" : String(response.currentId);
    elements.range.textContent = response.hasRange
      ? `${response.start}–${response.end}`
      : "не задан";
    elements.progress.textContent = response.hasRange
      ? `${stats.done || 0} / ${stats.total || 0} (${stats.percent || 0}%)`
      : "—";
    elements.bar.style.width = `${response.hasRange ? stats.percent || 0 : 0}%`;
    elements.done.disabled = !response.hasRange || response.currentId === null;
    elements.next.disabled = !response.hasRange || stats.next === null;
    setStatus(
      response.hasRange
        ? `Осталось ${stats.remaining || 0}. Следующий: ${stats.next ?? "все готово"}`
        : "Откройте панель и задайте диапазон ID."
    );
  }

  async function refresh() {
    tab = await activeTab();
    if (!tab) {
      setStatus("Нет активной вкладки", true);
      setPanelButtonsEnabled(false);
      return;
    }
    elements.permission.hidden = true;
    if (!isHttpUrl(tab.url)) {
      setStatus(
        "Активна служебная вкладка (about:...). Переключитесь на вкладку CVAT и откройте popup снова.",
        true
      );
      setPanelButtonsEnabled(false);
      return;
    }
    if (!isCvatUrl(tab.url)) {
      setStatus(
        "Это не похоже на CVAT. Откройте задачу /tasks/<id>/jobs/<id> и нажмите иконку расширения на этой вкладке.",
        true
      );
      setPanelButtonsEnabled(false);
      return;
    }
    const allowed = await hasSitePermission();
    if (!allowed) {
      elements.permission.hidden = false;
      setStatus(
        "У расширения нет доступа к сайтам. Нажмите «Разрешить доступ к сайтам».",
        true
      );
      setPanelButtonsEnabled(false);
      return;
    }
    const response = await ensureContentScript(tab.id);
    renderStatus(response);
  }

  elements.open.addEventListener("click", async () => {
    const response = await send("food-outline:open");
    if (!response || !response.ok) {
      setStatus(
        `Не удалось открыть панель: ${response && response.error ? response.error : "нет ответа"}`,
        true
      );
      return;
    }
    window.close();
  });

  elements.done.addEventListener("click", async () => {
    const response = await send("food-outline:mark-done");
    if (!response || !response.ok) {
      setStatus(
        `Не удалось отметить: ${response && response.error ? response.error : "нет ответа"}`,
        true
      );
      return;
    }
    await refresh();
  });

  elements.next.addEventListener("click", async () => {
    const response = await send("food-outline:next");
    if (!response || !response.ok) {
      setStatus("Следующая карточка не найдена.", true);
      return;
    }
    await refresh();
  });

  elements.permission.addEventListener("click", async () => {
    if (!api.permissions || !api.permissions.request) {
      setStatus("API разрешений недоступен в этом Firefox.", true);
      return;
    }
    try {
      const granted = await api.permissions.request({ origins: ["*://*/*"] });
      setStatus(
        granted ? "Доступ к сайтам выдан" : "Доступ не выдан",
        !granted
      );
      await refresh();
    } catch (error) {
      setStatus(`Не удалось запросить доступ: ${error.message || error}`, true);
    }
  });

  elements.ingredients.addEventListener("click", async () => {
    const response = await send("food-outline:open-ingredients");
    if (!response || !response.ok) {
      setStatus(
        `Не удалось открыть ингредиенты: ${response && response.error ? response.error : "нет ответа"}`,
        true
      );
      return;
    }
    window.close();
  });

  elements.options.addEventListener("click", () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  refresh();
})();
