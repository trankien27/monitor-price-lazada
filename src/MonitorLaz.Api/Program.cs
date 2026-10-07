using MonitorLaz.Api;

EnvFile.Load(Path.Combine(Directory.GetCurrentDirectory(), ".env"));
EnvFile.Load(Path.Combine(AppContext.BaseDirectory, ".env"));

var builder = WebApplication.CreateBuilder(args);
// Telegram embeds the bot token in the request URL; never let HttpClient log that URL.
builder.Logging.AddFilter("System.Net.Http.HttpClient.TelegramClient", LogLevel.Warning);
builder.Services.AddSingleton<MonitorState>();
builder.Services.AddSingleton<ProductStore>();
builder.Services.AddHttpClient<TelegramClient>();
builder.Services.AddHostedService<LazadaMonitorService>();
builder.Services.AddHealthChecks();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseWhen(context => context.Request.Path.StartsWithSegments("/api"), apiApp =>
{
    apiApp.Use(async (context, next) =>
    {
        var adminKey = Environment.GetEnvironmentVariable("ADMIN_KEY");
        if (string.IsNullOrWhiteSpace(adminKey) || context.Request.Headers["x-admin-key"] == adminKey)
        {
            await next();
            return;
        }
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { error = "Khóa quản trị không đúng" });
    });
});
app.MapGet("/api/info", () => Results.Ok(new
{
    service = "MonitorLaz",
    status = "running",
    serverTime = DateTimeOffset.UtcNow
}));
app.MapHealthChecks("/health");
app.MapGet("/status", (MonitorState state) => Results.Ok(state.Snapshot()));
app.MapGet("/api/products", async (ProductStore store, CancellationToken token) =>
    Results.Ok(await store.GetAsync(token)));
app.MapGet("/api/status", (MonitorState state) => Results.Ok(state.SnapshotMap()));
app.MapPost("/api/products", async (ProductOptions product, ProductStore store, CancellationToken token) =>
{
    try { return Results.Created("/api/products", await store.AddAsync(product, token)); }
    catch (ArgumentException exception) { return Results.BadRequest(new { error = exception.Message }); }
});
app.MapPut("/api/products/{id}", async (string id, ProductOptions product, ProductStore store, CancellationToken token) =>
{
    try
    {
        var updated = await store.UpdateAsync(id, product, token);
        return updated is null ? Results.NotFound(new { error = "Không tìm thấy sản phẩm" }) : Results.Ok(updated);
    }
    catch (ArgumentException exception) { return Results.BadRequest(new { error = exception.Message }); }
});
app.MapDelete("/api/products/{id}", async (string id, ProductStore store, CancellationToken token) =>
    await store.DeleteAsync(id, token) ? Results.NoContent() : Results.NotFound(new { error = "Không tìm thấy sản phẩm" }));
app.Run();
