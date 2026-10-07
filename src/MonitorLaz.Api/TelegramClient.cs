using System.Net.Http.Json;

namespace MonitorLaz.Api;

public sealed class TelegramClient(HttpClient httpClient)
{
    public async Task SendAsync(string text, CancellationToken cancellationToken)
    {
        var token = Environment.GetEnvironmentVariable("TELEGRAM_BOT_TOKEN");
        var chatId = Environment.GetEnvironmentVariable("TELEGRAM_CHAT_ID");
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(chatId))
            throw new InvalidOperationException("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");

        using var response = await httpClient.PostAsJsonAsync(
            $"https://api.telegram.org/bot{token}/sendMessage",
            new
            {
                chat_id = chatId,
                text,
                disable_web_page_preview = false
            },
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException($"Telegram returned {(int)response.StatusCode}: {body}");
        }
    }
}
