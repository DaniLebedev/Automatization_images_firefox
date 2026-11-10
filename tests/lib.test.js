"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/lib.js");

test("parseIdFromUrl reads frame from query", () => {
  const result = L.parseIdFromUrl("https://app.cvat.ai/tasks/12/jobs/34?frame=56");
  assert.equal(result.id, 56);
  assert.equal(result.param, "frame");
  assert.equal(result.scope, "https://app.cvat.ai/tasks/12/jobs/34");
});

test("parseIdFromUrl reads frame from hash query", () => {
  const result = L.parseIdFromUrl(
    "http://localhost:8000/#/tasks/1/jobs/2?frame=77"
  );
  assert.equal(result.id, 77);
  assert.equal(result.param, "frame");
  assert.equal(result.scope, "http://localhost:8000/#/tasks/1/jobs/2");
});

test("parseIdFromUrl ignores non-numeric ids", () => {
  const result = L.parseIdFromUrl("https://example.com/page?frame=abc");
  assert.equal(result.id, null);
});

test("normalizeRange validates and counts", () => {
  assert.deepEqual(L.normalizeRange("50", "100"), { start: 50, end: 100, total: 51 });
  assert.equal(L.normalizeRange("100", "50").error, "Начало должно быть меньше или равно концу");
  assert.ok(L.normalizeRange("", "10").error);
});

test("computeStats counts only ids inside the range", () => {
  const stats = L.computeStats(50, 100, { 49: 1, 50: 1, 55: 1, 99: 1 }, 55);
  assert.equal(stats.total, 51);
  assert.equal(stats.done, 3);
  assert.equal(stats.remaining, 48);
  assert.equal(stats.percent, 6);
  assert.equal(stats.currentDone, true);
  assert.equal(stats.next, 56);
});

test("nextIncomplete wraps and returns null when done", () => {
  assert.equal(L.nextIncomplete(1, 5, { 1: 1, 2: 1, 4: 1 }, 2), 3);
  assert.equal(L.nextIncomplete(1, 5, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, 3), null);
  assert.equal(L.nextIncomplete(1, 5, { 1: 1, 3: 1 }, null), 2);
});

test("formatDuration and eta", () => {
  assert.equal(L.formatDuration(12_000), "12 с");
  assert.equal(L.formatDuration(65_000), "1м 05с");
  assert.match(L.formatEta(10_000, 5), /~50 с/);
  assert.equal(L.formatEta(0, 5), "—");
});

test("isCvatLike recognizes CVAT and demo URLs", () => {
  assert.equal(L.isCvatLike("https://app.cvat.ai/tasks/1/jobs/2?frame=3"), true);
  assert.equal(L.isCvatLike("http://localhost:8000/demo/?frame=3"), true);
  assert.equal(L.isCvatLike("https://example.com/"), false);
});

test("buildReport includes completed ids", () => {
  const report = L.buildReport("scope", 1, 3, { 1: 1, 3: 1 }, 5000);
  assert.equal(report.completed, 2);
  assert.deepEqual(report.completedIds, [1, 3]);
  assert.equal(report.percent, 67);
});
