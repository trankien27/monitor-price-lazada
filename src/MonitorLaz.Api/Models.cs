namespace MonitorLaz.Api;

public sealed record ProductOptions(
    string Name,
    string Url,
    decimal? TargetPrice = null,
    bool Enabled = true);

public sealed record ProductStatus(
    string Name,
    decimal? Price,
    DateTimeOffset? CheckedAt,
    string? Error);

public sealed class MonitorState
{
    private readonly object _gate = new();
    private readonly Dictionary<string, ProductStatus> _products = new();

    public void Update(string key, ProductStatus status)
    {
        lock (_gate) _products[key] = status;
    }

    public ProductStatus? Get(string key)
    {
        lock (_gate) return _products.GetValueOrDefault(key);
    }

    public object Snapshot()
    {
        lock (_gate)
        {
            return new
            {
                status = "running",
                products = _products.Values.ToArray(),
                serverTime = DateTimeOffset.UtcNow
            };
        }
    }
}
