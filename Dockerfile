# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY src/MonitorLaz.Api/MonitorLaz.Api.csproj src/MonitorLaz.Api/
RUN dotnet restore src/MonitorLaz.Api/MonitorLaz.Api.csproj
COPY src/MonitorLaz.Api/ src/MonitorLaz.Api/
COPY products.json ./products.json
RUN dotnet publish src/MonitorLaz.Api/MonitorLaz.Api.csproj \
    --configuration Release \
    --runtime linux-x64 \
    --self-contained true \
    --output /app/publish \
    -p:PublishSingleFile=false

FROM mcr.microsoft.com/playwright/dotnet:v1.62.0-noble AS runtime
WORKDIR /app
COPY --from=build /app/publish ./
ENV ASPNETCORE_URLS=http://0.0.0.0:8080 \
    DOTNET_EnableDiagnostics=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 8080
ENTRYPOINT ["./MonitorLaz.Api"]
