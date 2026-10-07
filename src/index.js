import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("products.json phai co it nhat 1 san pham");
  }
  for (const [index, product] of products.entries()) {
    if (!product.name || !product.url) {
      throw new Error(`San pham thu ${index + 1} thieu name hoac url`);
    }
    if (!new URL(product.url).hostname.endsWith("lazada.vn")) {
      throw new Error(`URL cua '${product.name}' khong thuoc lazada.vn`);
    }
  }
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
      const firstCheck = !previous?.price;
      const changed = previous?.price && previous.price !== price;
      const reachedTarget = product.targetPrice && price <= product.targetPrice;
      const newlyReachedTarget = reachedTarget && (!previous?.price || previous.price > product.targetPrice);
      console.log(`  Gia: ${formatVnd(price)} (${source})`);
      state[key] = { price, checkedAt: now, source, lastError: null };
      await saveState(state);

      const notifyFirst = envBoolean("NOTIFY_ON_FIRST_CHECK", true);
      const notifyEveryCheck = process.argv.includes("--notify-every-check") || envBoolean("NOTIFY_EVERY_CHECK", false);
      if (notifyEveryCheck || (firstCheck && notifyFirst) || changed || newlyReachedTarget) {
        const heading = changed
          ? "🔔 Gia Lazada da thay doi"
          : reachedTarget
            ? "🎯 Gia Lazada dat muc mong muon"
            : firstCheck
              ? "✅ Bat dau theo doi gia Lazada"
              : "🕒 Cap nhat gia Lazada dinh ky";
        const lines = [heading, product.name, `Gia hien tai: ${formatVnd(price)}`];
        if (changed) lines.push(`Gia truoc: ${formatVnd(previous.price)}`);
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

  const products = await readJson(productsPath, await readJson(legacyProductPath, null));
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

  const shutdown = async () => {
    await context.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    do {
      await runCheck(context, products, state);
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
