export async function sendTelegram({ token, chatId, text }) {
  if (!token || !chatId) {
    throw new Error("Thieu TELEGRAM_BOT_TOKEN hoac TELEGRAM_CHAT_ID trong .env");
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`Telegram tra ve loi: ${payload?.description || response.status}`);
  }
  return payload.result;
}
