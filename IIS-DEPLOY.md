# Deploy lên IIS

Gói đã publish nằm trong `artifacts/iis` và file ZIP nằm tại `artifacts/MonitorLaz-IIS.zip`.

Mở PowerShell bằng **Run as administrator**, chuyển đến thư mục dự án và chạy:

```powershell
.\deploy-iis.ps1
```

Mặc định script sẽ:

- tạo application pool `MonitorLaz` ở chế độ No Managed Code;
- chép ứng dụng vào `C:\inetpub\MonitorLaz`;
- chép `.env` riêng của máy vào thư mục triển khai;
- cấp quyền ghi để dashboard cập nhật `products.json`;
- tạo site tại `http://localhost:8088`.

Có thể đổi tên, đường dẫn và cổng:

```powershell
.\deploy-iis.ps1 -SiteName MonitorLaz -SitePath D:\Sites\MonitorLaz -Port 8088
```

Máy chủ cần IIS và ASP.NET Core Hosting Bundle. Chromium đã được đóng kèm trong gói publish.

Không đưa `.env` hoặc ZIP triển khai chứa `.env` lên Git. Script lấy `.env` tại thời điểm triển khai.
