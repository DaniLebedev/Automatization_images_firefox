#!/usr/bin/env node
/**
 * Check config.local.json and optionally send a test request to the selected
 * vision API. The API key is never printed.
 *
 * Usage:
 *   node scripts/check-ai.mjs
 *   node scripts/check-ai.mjs --image path/to/food.jpg
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const L = require("../src/lib.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config.local.json");

function fail(message) {
  console.error(`check-ai: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(CONFIG_PATH)) {
  fail(
    `нет ${CONFIG_PATH}. Скопируйте config.example.json в config.local.json и вставьте apiKey.`
  );
}

const localConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const config = L.resolveAiConfig({}, localConfig);
if (config.error) {
  fail(config.error);
}
if (config.cloud && !config.hasKey) {
  fail("apiKey не заполнен в config.local.json");
}

const imageIndex = process.argv.indexOf("--image");
const imagePath =
  imageIndex >= 0 ? process.argv[imageIndex + 1] : undefined;
if (imageIndex >= 0 && !imagePath) {
  fail("после --image нужен путь к изображению");
}

function imageDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime =
    extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function resolveModel() {
  if (config.model) {
    return config.model;
  }
  if (config.provider !== "lmstudio") {
    fail(`для ${config.label} не задана модель`);
  }
  const response = await fetch(`${config.baseUrl}/models`, {
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  const models = (payload.data || [])
    .map((item) => String(item.id || ""))
    .filter(Boolean);
  const model =
    models.find((id) => /vl|vision|llava|internvl|qwen/i.test(id)) ||
    models[0];
  if (!model) {
    fail("в LM Studio не загружена модель");
  }
  return model;
}

const prompt = imagePath
  ? "List every visible edible ingredient in this food photo. " +
    "Use common English names. Exclude plates, people, tables and background. " +
    'Return ONLY JSON: {"ingredients":["fish","potato"]}'
  : "Reply with exactly one word: OK";

const model = await resolveModel();
const content = imagePath
  ? [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: imageDataUrl(imagePath) } },
    ]
  : prompt;

console.log(`Provider: ${config.provider} (${config.label})`);
console.log(`Model:    ${model}`);
console.log(`Base URL: ${config.baseUrl}`);
console.log(`Key:      ${config.hasKey ? "found in config.local.json" : "not required"}`);
console.log(`Test:     ${imagePath ? `image ${imagePath}` : "text request"}`);

const started = Date.now();
const response = await fetch(`${config.baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(config.cloud && config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {}),
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content }],
    temperature: 0,
    max_tokens: imagePath ? 400 : 8,
    stream: false,
  }),
  signal: AbortSignal.timeout(90_000),
});
const text = await response.text();
let payload = null;
try {
  payload = text ? JSON.parse(text) : null;
} catch {
  payload = null;
}

if (!response.ok) {
  const detail =
    payload && payload.error
      ? payload.error.message || JSON.stringify(payload.error)
      : text.slice(0, 500);
  fail(`HTTP ${response.status}: ${detail}`);
}

const answer =
  payload &&
  payload.choices &&
  payload.choices[0] &&
  payload.choices[0].message &&
  payload.choices[0].message.content;
console.log(`HTTP:     ${response.status}`);
console.log(`Latency:  ${Date.now() - started} ms`);
console.log("Answer:");
console.log(typeof answer === "string" ? answer : JSON.stringify(answer));
