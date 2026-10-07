# Monitor Lazada → Telegram (ASP.NET Core)

Backend C# dùng Playwright/Chromium để đọc giá Lazada theo chu kỳ và gửi Telegram. Dịch vụ có health endpoint để chạy liên tục trên Fly.io.

## Chạy tại máy

Yêu cầu .NET 10. Cấu hình bí mật trong `.env`:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
CHECK_INTERVAL_MINUTES=5
NOTIFY_ON_FIRST_CHECK=true
NOTIFY_EVERY_CHECK=false
```

Khai báo sản phẩm trong `products.json`:

```json
[
  {
    "name": "Tên sản phẩm",
    "url": "https://www.lazada.vn/products/pdp-i...html",
    "targetPrice": 1000000,
    "enabled": true
  }
]
```

Chạy backend:

```powershell
dotnet run --project src/MonitorLaz.Api
```

Các endpoint:

- `GET /health`: health check cho Fly.io.
- `GET /status`: giá và trạng thái kiểm tra gần nhất.

## Chạy bằng Docker

```powershell
docker build -t monitor-laz .
docker run --rm -p 8080:8080 --env-file .env monitor-laz
```

## Deploy Fly.io

1. Đổi `app` trong `fly.toml` thành một tên duy nhất, hoặc chạy `fly launch --no-deploy` để Fly tạo tên.
2. Đưa token Telegram vào Fly Secrets, không đưa `.env` vào image:

```powershell
fly secrets set TELEGRAM_BOT_TOKEN="..." TELEGRAM_CHAT_ID="..."
```

3. Deploy và xem log:

```powershell
fly deploy
fly logs
```

Mặc định Fly dùng region `sin`, 1 GB RAM và luôn giữ một Machine chạy để lịch theo dõi không bị ngủ. `products.json` được đóng gói trong image. Nếu không muốn lưu sản phẩm trong image, có thể đặt secret `MONITOR_PRODUCTS_JSON` bằng toàn bộ mảng JSON.

Lưu ý: ứng dụng không tự vượt CAPTCHA. Giá hiển thị có thể phụ thuộc vào phân loại, voucher, tài khoản và địa chỉ giao hàng.
