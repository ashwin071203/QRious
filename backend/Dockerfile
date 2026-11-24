# QRious API — ASP.NET Core 10 (build context: backend/)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props Directory.Packages.props ./
COPY src/QRious.Domain/QRious.Domain.csproj src/QRious.Domain/
COPY src/QRious.Infrastructure/QRious.Infrastructure.csproj src/QRious.Infrastructure/
COPY src/QRious.Application/QRious.Application.csproj src/QRious.Application/
COPY src/QRious.Api/QRious.Api.csproj src/QRious.Api/
RUN dotnet restore src/QRious.Api/QRious.Api.csproj
COPY src/ src/
RUN dotnet publish src/QRious.Api/QRious.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
# SkiaSharp NoDependencies native assets need fontconfig-free libs only; no extra packages required.
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "QRious.Api.dll"]
