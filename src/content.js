(function () {
  "use strict";

  const HUD_VERSION = "0.1.5";
  const L = globalThis.FoodOutlineLib;
  if (!L) {
    return;
  }
  if (globalThis.__foodOutlineHudVersion === HUD_VERSION) {
    return;
  }
  globalThis.__foodOutlineHudVersion = HUD_VERSION;
  const previousHost = document.getElementById("food-outline-hud-root");
  if (previousHost) {
    previousHost.remove();
  }

  const api = typeof browser !== "undefined" ? browser : chrome;
  const storage = api.storage.local;
  const SETTINGS_KEY = "fo:settings";
  const STATE_PREFIX = "fo:state:";
  const DEFAULT_SETTINGS = {
    autoOpen: true,
    autoNext: true,
    showLauncher: true,
  };

  let settings = { ...DEFAULT_SETTINGS };
  let state = null;
  let currentId = null;
  let manualCurrent = null;
  let lastRenderedId = null;
  let messageTimer = null;
  let syncTimer = null;
  let shadow = null;
  let panel = null;
  let launcher = null;
  let cssText = "";

  const DEFAULT_STATE = (scope) => ({
    version: 1,
    scope,
    start: null,
    end: null,
    completed: {},
    autoNext: settings.autoNext,
    panelOpen: false,
    collapsed: false,
    startedAt: null,
    lastDoneAt: null,
    timeSpentMs: 0,
    position: null,
    updatedAt: null,
  });

  function currentScope() {
    return L.parseIdFromUrl(location.href).scope || `${location.origin}${location.pathname}`;
  }

  function stateKey() {
    return `${STATE_PREFIX}${currentScope()}`;
  }

  async function loadSettings() {
    try {
      const data = await storage.get(SETTINGS_KEY);
      settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
    } catch (_error) {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  async function loadState() {
    try {
      const data = await storage.get(stateKey());
      state = { ...DEFAULT_STATE(currentScope()), ...(data[stateKey()] || {}) };
    } catch (_error) {
      state = DEFAULT_STATE(currentScope());
    }
    if (state.start === null || state.end === null) {
      state.start = null;
      state.end = null;
    }
    state.autoNext =
      typeof state.autoNext === "boolean" ? state.autoNext : settings.autoNext;
  }

  function saveState() {
    if (!state) {
      return;
    }
    state.updatedAt = new Date().toISOString();
    try {
      storage.set({ [stateKey()]: state });
    } catch (_error) {
      showMessage("Не удалось сохранить прогресс", true);
    }
  }

  function hasRange() {
    return Boolean(state && Number.isFinite(state.start) && Number.isFinite(state.end));
  }

  function stats() {
    if (!hasRange()) {
      return L.computeStats(0, -1, {}, currentId);
    }
    return L.computeStats(state.start, state.end, state.completed, currentId);
  }

  function syncCurrentId() {
    const fromUrl = L.parseIdFromUrl(location.href).id;
    if (fromUrl !== null) {
      manualCurrent = null;
      currentId = fromUrl;
    } else if (manualCurrent !== null) {
      currentId = manualCurrent;
    } else {
      currentId = L.parseIdFromDocument(document);
    }
    return currentId;
  }

  function getEl(role) {
    return shadow ? shadow.querySelector(`[data-role="${role}"]`) : null;
  }

  function setText(role, text) {
    const el = getEl(role);
    if (el) {
      el.textContent = text;
    }
  }

  function showMessage(text, isError) {
    const el = getEl("message");
    if (!el) {
      return;
    }
    el.textContent = text;
    el.classList.toggle("is-error", Boolean(isError));
    el.classList.add("is-visible");
    if (messageTimer) {
      clearTimeout(messageTimer);
    }
    messageTimer = setTimeout(() => {
      el.classList.remove("is-visible");
    }, 3500);
  }

  function render() {
    if (!state) {
      return;
    }
    syncCurrentId();
    const s = stats();
    const current = currentId === null ? "—" : String(currentId);
    setText("current", current);
    const currentBadge = getEl("current");
    if (currentBadge) {
      currentBadge.classList.toggle(
        "is-outside",
        currentId !== null && hasRange() && (currentId < state.start || currentId > state.end)
      );
    }

    const startInput = getEl("start");
    const endInput = getEl("end");
    if (startInput && document.activeElement !== startInput) {
      startInput.value = state.start === null ? "" : String(state.start);
    }
    if (endInput && document.activeElement !== endInput) {
      endInput.value = state.end === null ? "" : String(state.end);
    }

    const bar = getEl("bar");
    if (bar) {
      bar.style.width = `${hasRange() ? s.percent : 0}%`;
    }
    setText(
      "progress-text",
      hasRange() ? `${s.done} / ${s.total} (${s.percent}%)` : "Задайте диапазон ID"
    );
    setText("done-count", String(s.done));
    setText("remaining-count", String(s.remaining));
    setText("total-count", String(s.total));

    const elapsed = state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : 0;
    const average = s.done > 0 ? state.timeSpentMs / s.done : 0;
    setText("elapsed", L.formatDuration(elapsed));
    setText("average", s.done > 0 ? L.formatDuration(average) : "—");
    setText("eta", hasRange() ? L.formatEta(average, s.remaining) : "—");

    const doneButton = getEl("done");
    const undoneButton = getEl("undone");
    if (doneButton) {
      doneButton.disabled = !hasRange() || currentId === null || s.currentDone;
    }
    if (undoneButton) {
      undoneButton.disabled = !s.currentDone;
    }
    const nextButton = getEl("next");
    if (nextButton) {
      nextButton.disabled = !hasRange() || s.next === null;
    }
    const prevButton = getEl("prev");
    if (prevButton) {
      prevButton.disabled = !hasRange() || currentId === null || currentId <= state.start;
    }

    const autoNext = getEl("auto-next");
    if (autoNext) {
      autoNext.checked = Boolean(state.autoNext);
    }
    setText("range-label", hasRange() ? `${state.start}–${state.end}` : "—");
    setText("scope-label", shortScope());

    const details = getEl("completed-list");
    if (details) {
      details.textContent =
        s.completedIds.length > 0 ? s.completedIds.join(", ") : "пока пусто";
    }

    panel.classList.toggle("is-collapsed", Boolean(state.collapsed));
    panel.classList.toggle("is-hidden", !state.panelOpen);
    launcher.classList.toggle("is-visible", !state.panelOpen && settings.showLauncher);
    lastRenderedId = currentId;
  }

  function shortScope() {
    const scope = currentScope();
    try {
      const url = new URL(scope);
      const path = url.pathname.replace(/\/+$/, "");
      return `${url.hostname}${path || "/"}`;
    } catch (_error) {
      return scope;
    }
  }

  function applyRange() {
    const startInput = getEl("start");
    const endInput = getEl("end");
    const result = L.normalizeRange(startInput.value, endInput.value);
    if (result.error) {
      showMessage(result.error, true);
      return;
    }
    const changed = state.start !== result.start || state.end !== result.end;
    state.start = result.start;
    state.end = result.end;
    if (changed) {
      state.startedAt = new Date().toISOString();
      state.timeSpentMs = 0;
      state.lastDoneAt = null;
    }
    saveState();
    showMessage(`Диапазон ${result.start}–${result.end}: ${result.total} карточек`);
    render();
  }

  function markDone() {
    syncCurrentId();
    if (!hasRange() || currentId === null) {
      showMessage("Нет текущего ID или диапазона", true);
      return;
    }
    if (currentId < state.start || currentId > state.end) {
      showMessage("Текущий ID вне диапазона", true);
      return;
    }
    if (!state.startedAt) {
      state.startedAt = new Date().toISOString();
    }
    const now = Date.now();
    if (state.lastDoneAt) {
      const delta = Math.min(now - new Date(state.lastDoneAt).getTime(), 30 * 60 * 1000);
      if (delta > 0) {
        state.timeSpentMs += delta;
      }
    }
    state.lastDoneAt = new Date(now).toISOString();
    state.completed[String(currentId)] = now;
    saveState();
    render();
    showMessage(`ID ${currentId} отмечен`);
    if (state.autoNext) {
      const next = stats().next;
      if (next !== null) {
        setTimeout(() => goToId(next), 250);
      }
    }
  }

  function markUndone() {
    syncCurrentId();
    if (!state || currentId === null) {
      return;
    }
    if (state.completed[String(currentId)]) {
      delete state.completed[String(currentId)];
      saveState();
      render();
      showMessage(`ID ${currentId} снят с учёта`);
    }
  }

  function goToId(id) {
    if (id === null || id === undefined) {
      return;
    }
    const frameInput = L.findFrameInput(document);
    if (frameInput) {
      frameInput.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      if (setter) {
        setter.call(frameInput, String(id));
      } else {
        frameInput.value = String(id);
      }
      const enter = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
      };
      frameInput.dispatchEvent(new Event("input", { bubbles: true }));
      frameInput.dispatchEvent(new Event("change", { bubbles: true }));
      frameInput.dispatchEvent(new KeyboardEvent("keydown", enter));
      frameInput.dispatchEvent(new KeyboardEvent("keypress", enter));
      frameInput.dispatchEvent(new KeyboardEvent("keyup", enter));
      manualCurrent = id;
      currentId = id;
      render();
      window.setTimeout(() => {
        manualCurrent = null;
        syncCurrentId();
        render();
      }, 1000);
      return;
    }

    manualCurrent = null;
    const parsed = L.parseIdFromUrl(location.href);
    const url = new URL(location.href);
    if (parsed.param && url.searchParams.has(parsed.param)) {
      url.searchParams.set(parsed.param, String(id));
    } else if (parsed.source.startsWith("hash:") && parsed.param) {
      const hash = url.hash.replace(/^#/, "");
      const queryIndex = hash.indexOf("?");
      if (queryIndex >= 0) {
        const path = hash.slice(0, queryIndex);
        const params = new URLSearchParams(hash.slice(queryIndex + 1));
        params.set(parsed.param, String(id));
        url.hash = `#${path}?${params.toString()}`;
      }
    } else {
      url.searchParams.set("frame", String(id));
    }

    const jumpButton = [...document.querySelectorAll("button, [role='button']")].find(
      (button) =>
        /go to|перейти|jump/i.test(
          button.getAttribute("aria-label") || button.textContent || ""
        )
    );
    if (jumpButton) {
      jumpButton.click();
      return;
    }
    location.assign(url.toString());
  }

  function resetProgress() {
    if (!state) {
      return;
    }
    if (!window.confirm("Сбросить прогресс для этого диапазона?")) {
      return;
    }
    state.completed = {};
    state.timeSpentMs = 0;
    state.lastDoneAt = null;
    state.startedAt = hasRange() ? new Date().toISOString() : null;
    saveState();
    render();
    showMessage("Прогресс сброшен");
  }

  function exportProgress() {
    const report = L.buildReport(
      currentScope(),
      state.start,
      state.end,
      state.completed,
      state.timeSpentMs
    );
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `food-outline-${state.start ?? "x"}-${state.end ?? "y"}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function togglePanel(open) {
    if (!state) {
      return;
    }
    state.panelOpen = typeof open === "boolean" ? open : !state.panelOpen;
    saveState();
    render();
  }

  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    saveState();
    render();
  }

  function makeDraggable(handle) {
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, input, select, label")) {
        return;
      }
      const rect = panel.getBoundingClientRect();
      drag = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag) {
        return;
      }
      const maxX = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
      const maxY = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
      const left = Math.min(maxX, Math.max(8, event.clientX - drag.offsetX));
      const top = Math.min(maxY, Math.max(8, event.clientY - drag.offsetY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      state.position = { left, top };
    });
    handle.addEventListener("pointerup", (event) => {
      if (!drag) {
        return;
      }
      drag = null;
      panel.classList.remove("is-dragging");
      handle.releasePointerCapture(event.pointerId);
      saveState();
    });
  }

  function buildUi(css) {
    const host = document.createElement("div");
    host.id = "food-outline-hud-root";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.width = "100vw";
    host.style.height = "100vh";
    host.style.pointerEvents = "none";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    shadow.appendChild(style);
    const markup = `
      <button class="fo-launcher" type="button" data-action="open" title="Food Outline">FO</button>
      <section class="fo-panel is-hidden" role="dialog" aria-label="Food Outline progress">
        <header class="fo-head" data-role="drag">
          <span class="fo-logo">🍟</span>
          <span class="fo-title">Food Outline</span>
          <span class="fo-current" data-role="current">—</span>
          <button type="button" class="fo-icon" data-action="set-id" title="Задать ID вручную">✎</button>
          <button type="button" class="fo-icon" data-action="collapse" title="Свернуть">−</button>
          <button type="button" class="fo-icon" data-action="close" title="Закрыть">×</button>
        </header>
        <div class="fo-body">
          <div class="fo-range">
            <label>с <input type="number" min="0" step="1" data-role="start" placeholder="0"></label>
            <label>по <input type="number" min="0" step="1" data-role="end" placeholder="99"></label>
            <button type="button" class="fo-primary" data-action="apply">OK</button>
          </div>
          <div class="fo-range-summary">
            <span>Диапазон: <b data-role="range-label">—</b></span>
            <span data-role="scope-label"></span>
          </div>
          <div class="fo-progress">
            <div class="fo-bar"><i data-role="bar"></i></div>
            <span data-role="progress-text">Задайте диапазон ID</span>
          </div>
          <div class="fo-stats">
            <span>Готово <b data-role="done-count">0</b></span>
            <span>Осталось <b data-role="remaining-count">0</b></span>
            <span>Всего <b data-role="total-count">0</b></span>
          </div>
          <div class="fo-stats fo-stats-muted">
            <span>Сессия <b data-role="elapsed">—</b></span>
            <span>Среднее <b data-role="average">—</b></span>
            <span>Осталось <b data-role="eta">—</b></span>
          </div>
          <div class="fo-actions">
            <button type="button" class="fo-primary" data-role="done" data-action="done">✓ Готово</button>
            <button type="button" data-role="undone" data-action="undone">↶ Снять</button>
            <button type="button" data-role="prev" data-action="prev">← Пред.</button>
            <button type="button" data-role="next" data-action="next">След. →</button>
          </div>
          <div class="fo-footer">
            <label class="fo-check"><input type="checkbox" data-role="auto-next"> авто-переход</label>
            <button type="button" class="fo-link" data-action="export">Экспорт</button>
            <button type="button" class="fo-link fo-danger" data-action="reset">Сброс</button>
          </div>
          <details class="fo-details">
            <summary>Отмеченные ID</summary>
            <div data-role="completed-list">пока пусто</div>
          </details>
          <div class="fo-message" data-role="message"></div>
          <div class="fo-hint">Alt+Shift+D — готово · Alt+Shift+N — следующий · Alt+Shift+U — снять</div>
        </div>
      </section>
    `;
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    for (const node of Array.from(parsed.body.childNodes)) {
      shadow.appendChild(document.importNode(node, true));
    }
    panel = shadow.querySelector(".fo-panel");
    launcher = shadow.querySelector(".fo-launcher");
    if (state.position && Number.isFinite(state.position.left)) {
      panel.style.left = `${state.position.left}px`;
      panel.style.top = `${state.position.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    makeDraggable(shadow.querySelector('[data-role="drag"]'));

    launcher.addEventListener("click", () => togglePanel(true));
    shadow.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", () => {
        const action = element.getAttribute("data-action");
        if (action === "open") {
          togglePanel(true);
        } else if (action === "close") {
          togglePanel(false);
        } else if (action === "collapse") {
          setCollapsed(!state.collapsed);
        } else if (action === "set-id") {
          const value = window.prompt("Текущий ID карточки", currentId === null ? "" : String(currentId));
          if (value !== null && /^\d+$/.test(value.trim())) {
            manualCurrent = Number(value.trim());
            render();
          }
        } else if (action === "apply") {
          applyRange();
        } else if (action === "done") {
          markDone();
        } else if (action === "undone") {
          markUndone();
        } else if (action === "next") {
          const next = stats().next;
          if (next === null) {
            showMessage("Все карточки в диапазоне готовы");
          } else {
            goToId(next);
          }
        } else if (action === "prev") {
          if (state.start !== null && currentId !== null && currentId > state.start) {
            goToId(currentId - 1);
          }
        } else if (action === "reset") {
          resetProgress();
        } else if (action === "export") {
          exportProgress();
        }
      });
    });
    const autoNext = getEl("auto-next");
    autoNext.addEventListener("change", () => {
      state.autoNext = autoNext.checked;
      saveState();
    });
    render();
  }

  async function loadCss() {
    if (cssText) {
      return cssText;
    }
    try {
      const response = await fetch(api.runtime.getURL("src/hud.css"));
      cssText = await response.text();
    } catch (_error) {
      cssText = "";
    }
    return cssText;
  }

  function onKeyDown(event) {
    if (!event.altKey || !event.shiftKey) {
      return;
    }
    const target = event.target;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "d") {
      event.preventDefault();
      markDone();
    } else if (key === "u") {
      event.preventDefault();
      markUndone();
    } else if (key === "n") {
      event.preventDefault();
      const next = stats().next;
      if (next !== null) {
        goToId(next);
      }
    } else if (key === "p") {
      event.preventDefault();
      togglePanel();
    }
  }

  function syncFromUrl() {
    const previous = currentId;
    syncCurrentId();
    if (previous !== currentId) {
      render();
    }
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }
    const ready = Boolean(shadow && panel && state);
    if (!ready && message.type !== "food-outline:status") {
      sendResponse({ ok: false, error: "ui-not-ready" });
      return undefined;
    }
    if (message.type === "food-outline:open") {
      togglePanel(true);
      sendResponse({ ok: true });
    } else if (message.type === "food-outline:close") {
      togglePanel(false);
      sendResponse({ ok: true });
    } else if (message.type === "food-outline:mark-done") {
      markDone();
      sendResponse({ ok: true });
    } else if (message.type === "food-outline:next") {
      const next = stats().next;
      if (next !== null) {
        goToId(next);
      }
      sendResponse({ ok: true, next });
    } else if (message.type === "food-outline:status") {
      sendResponse({
        ok: true,
        uiReady: Boolean(shadow && panel),
        currentId,
        stats: stats(),
        hasRange: hasRange(),
        start: state ? state.start : null,
        end: state ? state.end : null,
      });
    }
    return undefined;
  });

  async function init() {
    await loadSettings();
    await loadState();
    syncCurrentId();
    console.info("Food Outline", HUD_VERSION, location.href, "id=", currentId);
    const shouldShow =
      L.isCvatLike(location.href) ||
      Boolean(
        document.querySelector(
          'input[aria-label*="frame" i], input[class*="frame" i], [data-frame-number]'
        )
      ) ||
      state.panelOpen;
    if (!shouldShow) {
      console.info("Food Outline: page not recognized, HUD not created");
      return;
    }
    if (settings.autoOpen && L.isCvatLike(location.href) && !state.panelOpen) {
      state.panelOpen = true;
    }
    const css = await loadCss();
    buildUi(css);
    console.info("Food Outline HUD created");
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("hashchange", syncFromUrl);
    syncTimer = setInterval(syncFromUrl, 500);
    const observer = new MutationObserver(() => {
      syncFromUrl();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: false,
    });
    storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      const key = stateKey();
      if (changes[key] && changes[key].newValue) {
        state = { ...DEFAULT_STATE(currentScope()), ...changes[key].newValue };
        render();
      }
      if (changes[SETTINGS_KEY] && changes[SETTINGS_KEY].newValue) {
        settings = { ...DEFAULT_SETTINGS, ...changes[SETTINGS_KEY].newValue };
        render();
      }
    });
  }

  init();
})();
