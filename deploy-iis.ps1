param(
    [string]$SiteName = "MonitorLaz",
    [string]$SitePath = "C:\inetpub\MonitorLaz",
    [int]$Port = 8088
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Hay chay PowerShell bang quyen Administrator."
}

$projectRoot = $PSScriptRoot
$publishPath = Join-Path $projectRoot "artifacts\iis"
$envPath = Join-Path $projectRoot ".env"
if (-not (Test-Path -LiteralPath $publishPath)) { throw "Khong tim thay artifacts\iis. Hay publish truoc." }
if (-not (Test-Path -LiteralPath $envPath)) { throw "Khong tim thay .env." }

Import-Module WebAdministration -SkipEditionCheck
New-Item -ItemType Directory -Path $SitePath -Force | Out-Null
Copy-Item -Path (Join-Path $publishPath "*") -Destination $SitePath -Recurse -Force
Copy-Item -LiteralPath $envPath -Destination (Join-Path $SitePath ".env") -Force

if (-not (Test-Path "IIS:\AppPools\$SiteName")) {
    New-WebAppPool -Name $SiteName | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$SiteName" -Name managedRuntimeVersion -Value ""
Set-ItemProperty "IIS:\AppPools\$SiteName" -Name processModel.identityType -Value ApplicationPoolIdentity
Set-ItemProperty "IIS:\AppPools\$SiteName" -Name startMode -Value AlwaysRunning

if (Test-Path "IIS:\Sites\$SiteName") {
    Stop-Website -Name $SiteName
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $SitePath
} else {
    New-Website -Name $SiteName -PhysicalPath $SitePath -Port $Port -ApplicationPool $SiteName | Out-Null
}

$acl = Get-Acl -LiteralPath $SitePath
$rule = [Security.AccessControl.FileSystemAccessRule]::new(
    "IIS AppPool\$SiteName",
    "Modify",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow")
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $SitePath -AclObject $acl

Start-WebAppPool -Name $SiteName
Start-Website -Name $SiteName
Write-Host "Da deploy: http://localhost:$Port"
