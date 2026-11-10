(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const storage = api.storage.local;
  const SETTINGS_KEY = "fo:settings";
  const STATE_PREFIX = "fo:state:";

  const autoOpen = document.getElementById("auto-open");
  const autoNext = document.getElementById("auto-next");
  const showLauncher = document.getElementById("show-launcher");
  const scopeCount = document.getElementById("scope-count");
  const exportButton = document.getElementById("export");
  const clearButton = document.getElementById("clear");
  const importInput = document.getElementById("import");
  const message = document.getElementById("message");
  const aiProvider = document.getElementById("ai-provider");
  const aiModel = document.getElementById("ai-model");
  const aiStatus = document.getElementById("ai-status");
  const aiCheck = document.getElementById("ai-check");
  const aiTest = document.getElementById("ai-test");
  const lmUrl = document.getElementById("lm-url");
  const lmModel = document.getElementById("lm-model");

  let settings = {
    autoOpen: true,
    autoNext: true,
    showLauncher: true,
    aiProvider: "auto",
    aiModel: "",
    lmStudioUrl: "http://localhost:1234/v1",
    lmStudioModel: "",
  };

  function showMessage(text, isError) {
    message.textContent = text;
    message.classList.add("is-visible");
    message.classList.toggle("is-error", Boolean(isError));
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => {
      message.classList.remove("is-visible");
    }, 4000);
  }

  async function load() {
    const data = await storage.get(null);
    settings = { ...settings, ...(data[SETTINGS_KEY] || {}) };
    autoOpen.checked = Boolean(settings.autoOpen);
    autoNext.checked = Boolean(settings.autoNext);
    showLauncher.checked = Boolean(settings.showLauncher);
    aiProvider.value = settings.aiProvider || "auto";
    aiModel.value = settings.aiModel || "";
    lmUrl.value = settings.lmStudioUrl || "http://localhost:1234/v1";
    lmModel.value = settings.lmStudioModel || "";
    const keys = Object.keys(data).filter((key) => key.startsWith(STATE_PREFIX));
    scopeCount.textContent = `Сохранено диапазонов: ${keys.length}`;
    checkAiConfig(false);
  }

  async function saveSettings() {
    settings = {
      autoOpen: autoOpen.checked,
      autoNext: autoNext.checked,
      showLauncher: showLauncher.checked,
      aiProvider: aiProvider.value,
      aiModel: aiModel.value.trim(),
      lmStudioUrl: lmUrl.value.trim() || "http://localhost:1234/v1",
      lmStudioModel: lmModel.value.trim(),
    };
    await storage.set({ [SETTINGS_KEY]: settings });
    showMessage("Настройки сохранены");
  }

  async function checkAiConfig(showToast) {
    aiStatus.classList.remove("status-error");
    aiStatus.textContent = "Проверяю config.local.json…";
    try {
      const response = await api.runtime.sendMessage({
        type: "food-outline:ai-status",
      });
      if (!response || !response.ok) {
        throw new Error(
          response && response.error ? response.error : "нет ответа"
        );
      }
      if (response.cloud && !response.hasKey) {
        aiStatus.classList.add("status-error");
        aiStatus.textContent =
          "Ключ не найден. Создайте config.local.json из config.example.json и вставьте apiKey.";
      } else {
        aiStatus.textContent = `${response.label}: ${response.model || "auto"}` +
          ` · ключ ${response.hasKey ? "найден" : "не требуется"}` +
          ` · ${response.source}`;
      }
      if (showToast) {
        showMessage("Конфигурация AI проверена");
      }
    } catch (error) {
      aiStatus.classList.add("status-error");
      const detail = String(error.message || error);
      aiStatus.textContent = detail.includes("Receiving end does not exist")
        ? "Нет связи с background-скриптом. Перезагрузите расширение в about:debugging."
        : `Ошибка AI: ${detail}`;
      if (showToast) {
        showMessage("Не удалось проверить AI", true);
      }
    }
  }

  async function testAiApi() {
    aiStatus.classList.remove("status-error");
    aiStatus.textContent = "Проверяю API запросом к модели…";
    try {
      const response = await api.runtime.sendMessage({
        type: "food-outline:ai-test",
      });
      if (!response || !response.ok) {
        throw new Error(
          response && response.error ? response.error : "нет ответа"
        );
      }
      aiStatus.textContent =
        `${response.label}: ${response.model} · API OK за ${response.latencyMs} мс` +
        ` · ответ: ${response.answer || "—"}`;
      showMessage("API работает");
    } catch (error) {
      aiStatus.classList.add("status-error");
      const detail = String(error.message || error);
      aiStatus.textContent = detail.includes("Receiving end does not exist")
        ? "Нет связи с background-скриптом. Перезагрузите расширение в about:debugging."
        : `Ошибка API: ${detail}`;
      showMessage("API не ответил", true);
    }
  }

  async function exportAll() {
    const data = await storage.get(null);
    const scopes = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(STATE_PREFIX)) {
        scopes[key] = value;
      }
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      scopes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "food-outline-progress.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showMessage(`Экспортировано диапазонов: ${Object.keys(scopes).length}`);
  }

  async function importFile(file) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const scopes = payload.scopes || payload;
      if (!scopes || typeof scopes !== "object") {
        throw new Error("bad payload");
      }
      const entries = {};
      for (const [key, value] of Object.entries(scopes)) {
        const storageKey = key.startsWith(STATE_PREFIX) ? key : `${STATE_PREFIX}${key}`;
        if (!value || typeof value !== "object") {
          continue;
        }
        entries[storageKey] = value;
      }
      if (Object.keys(entries).length === 0) {
        throw new Error("no scopes");
      }
      await storage.set(entries);
      if (payload.settings && typeof payload.settings === "object") {
        settings = { ...settings, ...payload.settings };
        await storage.set({ [SETTINGS_KEY]: settings });
      }
      await load();
      showMessage(`Импортировано диапазонов: ${Object.keys(entries).length}`);
    } catch (_error) {
      showMessage("Не удалось прочитать JSON прогресса", true);
    } finally {
      importInput.value = "";
    }
  }

  async function clearAll() {
    if (!window.confirm("Удалить весь сохранённый прогресс во всех диапазонах?")) {
      return;
    }
    const data = await storage.get(null);
    const keys = Object.keys(data).filter((key) => key.startsWith(STATE_PREFIX));
    if (keys.length > 0) {
      await storage.remove(keys);
    }
    await load();
    showMessage("Прогресс очищен");
  }

  autoOpen.addEventListener("change", saveSettings);
  autoNext.addEventListener("change", saveSettings);
  showLauncher.addEventListener("change", saveSettings);
  aiProvider.addEventListener("change", async () => {
    await saveSettings();
    await checkAiConfig(true);
  });
  aiModel.addEventListener("change", async () => {
    await saveSettings();
    await checkAiConfig(false);
  });
  aiCheck.addEventListener("click", () => checkAiConfig(true));
  aiTest.addEventListener("click", testAiApi);
  lmUrl.addEventListener("change", saveSettings);
  lmModel.addEventListener("change", saveSettings);
  exportButton.addEventListener("click", exportAll);
  clearButton.addEventListener("click", clearAll);
  importInput.addEventListener("change", () => importFile(importInput.files[0]));

  load();
})();
