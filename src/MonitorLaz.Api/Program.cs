using MonitorLaz.Api;

EnvFile.Load(Path.Combine(Directory.GetCurrentDirectory(), ".env"));

var builder = WebApplication.CreateBuilder(args);
// Telegram embeds the bot token in the request URL; never let HttpClient log that URL.
builder.Logging.AddFilter("System.Net.Http.HttpClient.TelegramClient", LogLevel.Warning);
builder.Services.AddSingleton<MonitorState>();
builder.Services.AddHttpClient<TelegramClient>();
builder.Services.AddHostedService<LazadaMonitorService>();
builder.Services.AddHealthChecks();

var app = builder.Build();
app.MapGet("/", () => Results.Ok(new
{
    service = "MonitorLaz",
    status = "running",
    serverTime = DateTimeOffset.UtcNow
}));
app.MapHealthChecks("/health");
app.MapGet("/status", (MonitorState state) => Results.Ok(state.Snapshot()));
app.Run();
