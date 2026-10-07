const PRICE_SELECTORS = [
  "[itemprop='price']",
  "meta[property='product:price:amount']",
  "[class*='product-price-content-salePrice-amount']",
  "[class*='salePrice-amount']",
  ".pdp-price_type_normal",
  ".pdp-product-price .pdp-price",
  ".notranslate.pdp-price",
  "[class*='pdp-price']"
];

export function parseVnd(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+\.\d{1,2}$/.test(text)) {
    const amount = Math.trunc(Number(text));
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  }
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function priceFromJson(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = priceFromJson(item);
      if (found) return found;
    }
    return null;
  }
  for (const key of ["price", "lowPrice"]) {
    if (value[key] !== undefined) {
      const found = parseVnd(value[key]);
      if (found) return found;
    }
  }
  for (const child of Object.values(value)) {
    const found = priceFromJson(child);
    if (found) return found;
  }
  return null;
}

export async function extractPrice(page) {
  const result = await page.evaluate((selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const raw = element.getAttribute("content") || element.textContent || "";
        if (/\d/.test(raw)) return { raw, source: selector };
      }
    }
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const data = JSON.parse(script.textContent || "null");
        if (data) return { json: data, source: "json-ld" };
      } catch {}
    }
    return null;
  }, PRICE_SELECTORS);

  if (!result) return null;
  const price = result.raw ? parseVnd(result.raw) : priceFromJson(result.json);
  return price ? { price, source: result.source } : null;
}

export function formatVnd(amount) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}
