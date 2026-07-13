# Run STUDY ZONE locally (required if file:// blocks API calls)
Set-Location $PSScriptRoot
Write-Host "Open in browser: http://localhost:8080" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
python -m http.server 8080
