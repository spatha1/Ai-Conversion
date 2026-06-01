# start_local_dev.ps1 — Start local backend via SSH tunnel to Azure VM DB
# Run this instead of uvicorn directly when working locally

Write-Host "Starting SSH tunnel: localhost:14330 -> VM SQL Server..." -ForegroundColor Cyan

# Kill any existing tunnel on port 14330
$existing = netstat -ano | Select-String ":14330 " | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
foreach ($p in $existing) { try { Stop-Process -Id $p -Force -EA SilentlyContinue } catch {} }

# Open SSH tunnel in background: local 14330 -> VM's SQL Server 127.0.0.1:1433
$tunnel = Start-Process -FilePath "ssh" `
    -ArgumentList "-i `"$env:USERPROFILE\.ssh\azure_vm_key.pem`" -L 14330:127.0.0.1:1433 azureuser@104.211.112.63 -N -o StrictHostKeyChecking=no -o ServerAliveInterval=30" `
    -WindowStyle Hidden -PassThru

Write-Host "Tunnel PID: $($tunnel.Id) — waiting for it to establish..." -ForegroundColor Yellow
Start-Sleep -Seconds 4

# Test tunnel
$conn = Test-NetConnection -ComputerName "localhost" -Port 14330 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $conn) {
    Write-Host "WARNING: Tunnel may not be ready yet, starting backend anyway..." -ForegroundColor Yellow
} else {
    Write-Host "Tunnel ready on localhost:14330" -ForegroundColor Green
}

# Set local DB override via environment variable (overrides .env without editing it)
$env:DB_SERVER = "localhost,14330"
Write-Host "DB_SERVER overridden to: localhost,14330" -ForegroundColor Green

# Kill any existing uvicorn
Get-Process python* -EA SilentlyContinue | Stop-Process -Force

Write-Host "Starting uvicorn..." -ForegroundColor Cyan
& ".venv\Scripts\python.exe" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Cleanup tunnel when uvicorn exits
Write-Host "Stopping SSH tunnel..." -ForegroundColor Yellow
Stop-Process -Id $tunnel.Id -Force -EA SilentlyContinue
