import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import express from "express";
import { chromium } from "playwright";
import { extractPrice, formatVnd } from "./price.js";
import { sendTelegram } from "./telegram.js";

const root = process.cwd();
const productsPath = path.join(root, "products.json");
const legacyProductPath = path.join(root, "product.json");
const dataDir = path.join(root, "data");
const statePath = path.join(dataDir, "state.json");
const profileDir = path.join(root, "playwright-profile");
const telegram = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID
};

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveState(state) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function saveProducts(products) {
  const temporaryPath = `${productsPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(products, null, 2)}\n`, "utf8");
  await rename(temporaryPath, productsPath);
}

function productKey(product) {
  return product.id || product.url;
}

function cleanProductUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function validateProducts(products) {
  if (!Array.isArray(products)) throw new Error("products.json phai la mot danh sach");
  for (const [index, product] of products.entries()) {
    if (!product.name || !product.url) {
      throw new Error(`San pham thu ${index + 1} thieu name hoac url`);
    }
    if (!new URL(product.url).hostname.endsWith("lazada.vn")) {
      throw new Error(`URL cua '${product.name}' khong thuoc lazada.vn`);
    }
  }
}

function normalizeProduct(input, existingId) {
  const name = String(input.name || "").trim();
  const url = String(input.url || "").trim();
  if (!name || !url) throw new Error("Ten va URL san pham la bat buoc");
  const parsedUrl = new URL(url);
  if (!parsedUrl.hostname.endsWith("lazada.vn")) {
    throw new Error("URL phai thuoc lazada.vn");
  }
  const targetPrice = input.targetPrice === "" || input.targetPrice === null || input.targetPrice === undefined
    ? null
    : Number(input.targetPrice);
  if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    throw new Error("Gia muc tieu khong hop le");
  }
  return {
    id: existingId || randomUUID(),
    name,
    url,
    targetPrice,
    enabled: input.enabled !== false
  };
}

async function ensureProductIds() {
  const products = await readJson(productsPath, await readJson(legacyProductPath, []));
  let changed = false;
  const normalized = products.map((product) => {
    if (product.id) return product;
    changed = true;
    return { ...product, id: randomUUID() };
  });
  if (changed || !(await readJson(productsPath, null))) await saveProducts(normalized);
  return normalized;
}

function startWebServer() {
  const app = express();
  const port = Math.max(1, Number(process.env.PORT || 3000));
  const adminKey = process.env.ADMIN_KEY || "";
  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(path.join(root, "public")));

  app.use("/api", (request, response, next) => {
    if (!adminKey || request.headers["x-admin-key"] === adminKey) return next();
    return response.status(401).json({ error: "Khoa quan tri khong dung" });
  });

  app.get("/api/products", async (_request, response, next) => {
    try {
      response.json(await ensureProductIds());
    } catch (error) { next(error); }
  });
  app.get("/api/status", async (_request, response, next) => {
    try {
      response.json(await readJson(statePath, {}));
    } catch (error) { next(error); }
  });
  app.post("/api/products", async (request, response, next) => {
    try {
      const products = await ensureProductIds();
      const product = normalizeProduct(request.body);
      products.push(product);
      await saveProducts(products);
      response.status(201).json(product);
    } catch (error) { next(error); }
  });
  app.put("/api/products/:id", async (request, response, next) => {
    try {
      const products = await ensureProductIds();
      const index = products.findIndex((product) => product.id === request.params.id);
      if (index < 0) return response.status(404).json({ error: "Khong tim thay san pham" });
      products[index] = normalizeProduct(request.body, products[index].id);
      await saveProducts(products);
      response.json(products[index]);
    } catch (error) { next(error); }
  });
  app.delete("/api/products/:id", async (request, response, next) => {
    try {
      const products = await ensureProductIds();
      const filtered = products.filter((product) => product.id !== request.params.id);
      if (filtered.length === products.length) return response.status(404).json({ error: "Khong tim thay san pham" });
      await saveProducts(filtered);
      response.status(204).end();
    } catch (error) { next(error); }
  });
  app.use((error, _request, response, _next) => {
    console.error(`API loi: ${error.message}`);
    response.status(400).json({ error: error.message });
  });
  return app.listen(port, "0.0.0.0", () => {
    console.log(`Dashboard: http://localhost:${port}`);
  });
}

async function notify(text) {
  await sendTelegram({ ...telegram, text });
}

async function inspectProduct(page, product) {
  await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4_000);
  const title = await page.title();
  if (/captcha|verify|security check/i.test(title)) {
    throw new Error("Lazada yeu cau xac minh/CAPTCHA");
  }
  const result = await extractPrice(page);
  if (!result) throw new Error("Khong tim thay gia tren trang");
  return result;
}

async function runCheck(context, products, state) {
  for (const product of products.filter((item) => item.enabled !== false)) {
    const key = productKey(product);
    const previous = state[key];
    const page = await context.newPage();
    try {
      console.log(`[${new Date().toLocaleString("vi-VN")}] Dang kiem tra: ${product.name}`);
      const { price, source } = await inspectProduct(page, product);
      const now = new Date().toISOString();
      const reachedTarget = product.targetPrice != null && price <= product.targetPrice;
      const newlyReachedTarget = reachedTarget && (!previous?.price || previous.price > product.targetPrice);
      console.log(`  Gia: ${formatVnd(price)} (${source})`);
      state[key] = { price, checkedAt: now, source, lastError: null };
      await saveState(state);

      if (newlyReachedTarget) {
        const lines = ["🎯 Gia Lazada dat muc mong muon", product.name, `Gia hien tai: ${formatVnd(price)}`];
        if (product.targetPrice) lines.push(`Muc canh bao: ${formatVnd(product.targetPrice)}`);
        lines.push(cleanProductUrl(product.url));
        try {
          await notify(lines.join("\n"));
        } catch (error) {
          console.error(`  Khong gui duoc Telegram: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`  Loi: ${error.message}`);
      state[key] = { ...previous, checkedAt: new Date().toISOString(), lastError: error.message };
      await saveState(state);
    } finally {
      await page.close();
    }
  }
}

async function main() {
  if (process.argv.includes("--test-telegram")) {
    await notify("✅ Monitor Lazada da ket noi Telegram thanh cong.");
    console.log("Da gui tin nhan thu nghiem.");
    return;
  }

  const products = await ensureProductIds();
  if (!products) throw new Error("Chua co products.json hoac product.json");
  validateProducts(products);
  const state = await readJson(statePath, {});
  const intervalMinutes = Math.max(1, Number(process.env.CHECK_INTERVAL_MINUTES || 5));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: envBoolean("HEADLESS", true),
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1366, height: 900 }
  });
  const server = startWebServer();

  const shutdown = async () => {
    server.close();
    await context.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    do {
      const currentProducts = await ensureProductIds();
      validateProducts(currentProducts);
      await runCheck(context, currentProducts, state);
      if (process.argv.includes("--once")) break;
      console.log(`Lan kiem tra tiep theo sau ${intervalMinutes} phut.`);
      await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
    } while (true);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(`Khong the khoi dong: ${error.message}`);
  process.exitCode = 1;
});
