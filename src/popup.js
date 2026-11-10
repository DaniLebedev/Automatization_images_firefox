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
    done: document.getElementById("done"),
    next: document.getElementById("next"),
    options: document.getElementById("options"),
  };

  let tab = null;

  function setStatus(text, isError) {
    elements.status.textContent = text;
    elements.status.style.color = isError ? "#ff9b9b" : "";
  }

  async function activeTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function send(type) {
    if (!tab) {
      return null;
    }
    try {
      return await api.tabs.sendMessage(tab.id, { type });
    } catch (_error) {
      return null;
    }
  }

  function renderStatus(response) {
    if (!response || !response.ok) {
      setStatus(
        "Панель недоступна на этой странице. Откройте CVAT или локальный CVAT.",
        true
      );
      elements.done.disabled = true;
      elements.next.disabled = true;
      return;
    }
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
      return;
    }
    renderStatus(await send("food-outline:status"));
  }

  elements.open.addEventListener("click", async () => {
    const response = await send("food-outline:open");
    if (!response || !response.ok) {
      setStatus("Не удалось открыть панель на этой вкладке.", true);
      return;
    }
    window.close();
  });

  elements.done.addEventListener("click", async () => {
    const response = await send("food-outline:mark-done");
    if (!response || !response.ok) {
      setStatus("Не удалось отметить карточку.", true);
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

  elements.options.addEventListener("click", () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  refresh();
})();
