using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Playwright;

namespace MonitorLaz.Api;

public sealed partial class LazadaMonitorService(
    ILogger<LazadaMonitorService> logger,
    IWebHostEnvironment environment,
    TelegramClient telegram,
    MonitorState state) : BackgroundService
{
    private static readonly string[] PriceSelectors =
    [
        "[itemprop='price']",
        "meta[property='product:price:amount']",
        "[class*='product-price-content-salePrice-amount']",
        "[class*='salePrice-amount']",
        ".pdp-price_type_normal",
        ".pdp-product-price .pdp-price",
        ".notranslate.pdp-price",
        "[class*='pdp-price']"
    ];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var products = await LoadProductsAsync(stoppingToken);
        var interval = TimeSpan.FromMinutes(ReadInt("CHECK_INTERVAL_MINUTES", 5, 1));
        var notifyEveryCheck = ReadBool("NOTIFY_EVERY_CHECK", false);
        var notifyOnFirstCheck = ReadBool("NOTIFY_ON_FIRST_CHECK", true);

        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync(new()
        {
            Headless = true,
            Args = ["--disable-dev-shm-usage", "--no-sandbox"]
        });

        logger.LogInformation("Monitoring {Count} product(s) every {Minutes} minute(s)", products.Count, interval.TotalMinutes);

        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var product in products.Where(product => product.Enabled))
            {
                await CheckProductAsync(
                    browser,
                    product,
                    notifyEveryCheck,
                    notifyOnFirstCheck,
                    stoppingToken);
            }

            await Task.Delay(interval, stoppingToken);
        }
    }

    private async Task CheckProductAsync(
        IBrowser browser,
        ProductOptions product,
        bool notifyEveryCheck,
        bool notifyOnFirstCheck,
        CancellationToken cancellationToken)
    {
        var key = product.Url;
        var previous = state.Get(key);
        await using var context = await browser.NewContextAsync(new()
        {
            Locale = "vi-VN",
            TimezoneId = "Asia/Ho_Chi_Minh",
            ViewportSize = new() { Width = 1366, Height = 900 }
        });
        var page = await context.NewPageAsync();

        try
        {
            logger.LogInformation("Checking {Product}", product.Name);
            await page.GotoAsync(product.Url, new()
            {
                WaitUntil = WaitUntilState.DOMContentLoaded,
                Timeout = 60_000
            });
            await page.WaitForTimeoutAsync(4_000);

            var title = await page.TitleAsync();
            if (Regex.IsMatch(title, "captcha|verify|security check", RegexOptions.IgnoreCase))
                throw new InvalidOperationException("Lazada requested CAPTCHA/verification");

            var price = await ExtractPriceAsync(page)
                ?? throw new InvalidOperationException("Could not find a price on the page");
            var now = DateTimeOffset.UtcNow;
            var firstCheck = previous?.Price is null;
            var changed = previous?.Price is not null && previous.Price != price;
            var reachedTarget = product.TargetPrice is not null && price <= product.TargetPrice;
            var newlyReachedTarget = reachedTarget && (previous?.Price is null || previous.Price > product.TargetPrice);

            state.Update(key, new(product.Name, price, now, null));
            logger.LogInformation("{Product}: {Price}", product.Name, FormatVnd(price));

            if (notifyEveryCheck || (firstCheck && notifyOnFirstCheck) || changed || newlyReachedTarget)
            {
                var heading = changed
                    ? "🔔 Giá Lazada đã thay đổi"
                    : reachedTarget
                        ? "🎯 Giá Lazada đạt mức mong muốn"
                        : firstCheck
                            ? "✅ Bắt đầu theo dõi giá Lazada"
                            : "🕒 Cập nhật giá Lazada định kỳ";
                var lines = new List<string>
                {
                    heading,
                    product.Name,
                    $"Giá hiện tại: {FormatVnd(price)}"
                };
                if (changed) lines.Add($"Giá trước: {FormatVnd(previous!.Price!.Value)}");
                if (product.TargetPrice is not null)
                    lines.Add($"Mức cảnh báo: {FormatVnd(product.TargetPrice.Value)}");
                lines.Add(CleanUrl(product.Url));

                try
                {
                    await telegram.SendAsync(string.Join('\n', lines), cancellationToken);
                }
                catch (Exception exception)
                {
                    logger.LogError(exception, "Failed to send Telegram notification");
                }
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Failed to check {Product}", product.Name);
            state.Update(key, new(product.Name, previous?.Price, DateTimeOffset.UtcNow, exception.Message));
        }
    }

    private static async Task<decimal?> ExtractPriceAsync(IPage page)
    {
        foreach (var selector in PriceSelectors)
        {
            var elements = await page.Locator(selector).AllAsync();
            foreach (var element in elements)
            {
                var raw = await element.GetAttributeAsync("content") ?? await element.TextContentAsync();
                var parsed = ParseVnd(raw);
                if (parsed is not null) return parsed;
            }
        }
        return null;
    }

    internal static decimal? ParseVnd(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var text = value.Trim();
        if (DecimalPriceRegex().IsMatch(text) && decimal.TryParse(text, CultureInfo.InvariantCulture, out var machinePrice))
            return decimal.Truncate(machinePrice);

        var digits = NonDigitRegex().Replace(text, "");
        return decimal.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var price) && price > 0
            ? price
            : null;
    }

    private async Task<List<ProductOptions>> LoadProductsAsync(CancellationToken cancellationToken)
    {
        var json = Environment.GetEnvironmentVariable("MONITOR_PRODUCTS_JSON");
        if (string.IsNullOrWhiteSpace(json))
        {
            var candidates = new[]
            {
                Path.Combine(environment.ContentRootPath, "products.json"),
                Path.Combine(Directory.GetCurrentDirectory(), "products.json"),
                Path.Combine(AppContext.BaseDirectory, "products.json"),
                Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "..", "products.json"))
            };
            var path = candidates.FirstOrDefault(File.Exists)
                ?? throw new FileNotFoundException("products.json was not found and MONITOR_PRODUCTS_JSON is empty");
            json = await File.ReadAllTextAsync(path, cancellationToken);
        }

        var products = JsonSerializer.Deserialize<List<ProductOptions>>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        if (products is null || products.Count == 0)
            throw new InvalidOperationException("At least one product must be configured");
        if (products.Any(product => !Uri.TryCreate(product.Url, UriKind.Absolute, out var uri) || !uri.Host.EndsWith("lazada.vn")))
            throw new InvalidOperationException("Every product URL must belong to lazada.vn");
        return products;
    }

    private static string CleanUrl(string rawUrl)
    {
        var uri = new Uri(rawUrl);
        return uri.GetLeftPart(UriPartial.Path);
    }

    private static string FormatVnd(decimal price) => $"{price:N0} ₫".Replace(',', '.');
    private static int ReadInt(string key, int fallback, int minimum) =>
        int.TryParse(Environment.GetEnvironmentVariable(key), out var value) ? Math.Max(minimum, value) : fallback;
    private static bool ReadBool(string key, bool fallback) =>
        bool.TryParse(Environment.GetEnvironmentVariable(key), out var value) ? value : fallback;

    [GeneratedRegex(@"^\d+\.\d{1,2}$")]
    private static partial Regex DecimalPriceRegex();

    [GeneratedRegex(@"[^0-9]")]
    private static partial Regex NonDigitRegex();
}
