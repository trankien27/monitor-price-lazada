using System.Text.Json;

namespace MonitorLaz.Api;

public sealed class ProductStore(IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private string FilePath => Path.Combine(environment.ContentRootPath, "products.json");

    public async Task<List<ProductOptions>> GetAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var products = await ReadUnsafeAsync(cancellationToken);
            var changed = false;
            for (var index = 0; index < products.Count; index++)
            {
                if (!string.IsNullOrWhiteSpace(products[index].Id)) continue;
                products[index] = products[index] with { Id = Guid.NewGuid().ToString("N") };
                changed = true;
            }
            if (changed) await WriteUnsafeAsync(products, cancellationToken);
            return products;
        }
        finally { _gate.Release(); }
    }

    public async Task<ProductOptions> AddAsync(ProductOptions input, CancellationToken cancellationToken)
    {
        var product = Validate(input with { Id = Guid.NewGuid().ToString("N") });
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var products = await ReadUnsafeAsync(cancellationToken);
            products.Add(product);
            await WriteUnsafeAsync(products, cancellationToken);
            return product;
        }
        finally { _gate.Release(); }
    }

    public async Task<ProductOptions?> UpdateAsync(string id, ProductOptions input, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var products = await ReadUnsafeAsync(cancellationToken);
            var index = products.FindIndex(product => product.Id == id);
            if (index < 0) return null;
            products[index] = Validate(input with { Id = id });
            await WriteUnsafeAsync(products, cancellationToken);
            return products[index];
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var products = await ReadUnsafeAsync(cancellationToken);
            var removed = products.RemoveAll(product => product.Id == id) > 0;
            if (removed) await WriteUnsafeAsync(products, cancellationToken);
            return removed;
        }
        finally { _gate.Release(); }
    }

    private async Task<List<ProductOptions>> ReadUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(FilePath)) return [];
        await using var stream = File.OpenRead(FilePath);
        return await JsonSerializer.DeserializeAsync<List<ProductOptions>>(stream, _jsonOptions, cancellationToken) ?? [];
    }

    private async Task WriteUnsafeAsync(List<ProductOptions> products, CancellationToken cancellationToken)
    {
        var temporaryPath = $"{FilePath}.tmp";
        await using (var stream = File.Create(temporaryPath))
            await JsonSerializer.SerializeAsync(stream, products, _jsonOptions, cancellationToken);
        File.Move(temporaryPath, FilePath, true);
    }

    private static ProductOptions Validate(ProductOptions product)
    {
        var name = product.Name?.Trim();
        var url = product.Url?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(url))
            throw new ArgumentException("Tên và URL sản phẩm là bắt buộc");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !uri.Host.EndsWith("lazada.vn"))
            throw new ArgumentException("URL phải thuộc lazada.vn");
        if (product.TargetPrice is <= 0)
            throw new ArgumentException("Giá mục tiêu không hợp lệ");
        return product with { Name = name, Url = url };
    }
}
