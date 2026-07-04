# FundAI Setup Script for Windows
# =================================
# Run with: .\setup.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "FundAI v0.2.0 - Automated Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "[1/8] Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js not found. Please install Node.js 18+ from nodejs.org" -ForegroundColor Red
    exit 1
}

# Check Python
try {
    $pythonVersion = python --version
    Write-Host "  ✓ Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Python not found. Please install Python 3.11+ from python.org" -ForegroundColor Red
    exit 1
}

# Check PostgreSQL
try {
    $pgVersion = psql --version
    Write-Host "  ✓ PostgreSQL: $pgVersion" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ PostgreSQL not found. Install from postgresql.org or use Docker" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[2/8] Installing Node.js dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Failed to install root dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Root dependencies installed" -ForegroundColor Green

# API
Set-Location apps/api
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Failed to install API dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ API dependencies installed" -ForegroundColor Green
Set-Location ../..

# Worker
Set-Location apps/worker
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Failed to install Worker dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Worker dependencies installed" -ForegroundColor Green
Set-Location ../..

Write-Host ""
Write-Host "[3/8] Installing Python dependencies..." -ForegroundColor Yellow
Set-Location services/quant-engine
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Failed to install Python dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Python dependencies installed" -ForegroundColor Green
Set-Location ../..

Write-Host ""
Write-Host "[4/8] Setting up environment files..." -ForegroundColor Yellow

# Create .env files if they don't exist
if (-not (Test-Path "apps/api/.env")) {
    @"
DATABASE_URL=postgresql://fundai:password@localhost:5432/fundai
JWT_SECRET=$(New-Guid)
WEB_APP_ORIGIN=http://localhost:3000
PORT=4000
QUANT_ENGINE_URL=http://localhost:8811
INTERNAL_SERVICE_TOKEN=$(New-Guid)
NODE_ENV=development
"@ | Out-File -FilePath "apps/api/.env" -Encoding UTF8
    Write-Host "  ✓ Created apps/api/.env" -ForegroundColor Green
} else {
    Write-Host "  • apps/api/.env already exists (skipping)" -ForegroundColor Gray
}

if (-not (Test-Path "apps/worker/.env")) {
    @"
DATABASE_URL=postgresql://fundai:password@localhost:5432/fundai
REDIS_HOST=localhost
REDIS_PORT=6379
QUANT_ENGINE_URL=http://localhost:8811
INTERNAL_SERVICE_TOKEN=$(Get-Content apps/api/.env | Select-String "INTERNAL_SERVICE_TOKEN" | ForEach-Object { $_.ToString().Split("=")[1] })
MARKET_DATA_PROVIDER=synthetic
NODE_ENV=development
"@ | Out-File -FilePath "apps/worker/.env" -Encoding UTF8
    Write-Host "  ✓ Created apps/worker/.env" -ForegroundColor Green
} else {
    Write-Host "  • apps/worker/.env already exists (skipping)" -ForegroundColor Gray
}

if (-not (Test-Path "services/quant-engine/.env")) {
    @"
INTERNAL_SERVICE_TOKEN=$(Get-Content apps/api/.env | Select-String "INTERNAL_SERVICE_TOKEN" | ForEach-Object { $_.ToString().Split("=")[1] })
"@ | Out-File -FilePath "services/quant-engine/.env" -Encoding UTF8
    Write-Host "  ✓ Created services/quant-engine/.env" -ForegroundColor Green
} else {
    Write-Host "  • services/quant-engine/.env already exists (skipping)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[5/8] Generating Prisma client..." -ForegroundColor Yellow
Set-Location apps/api
npx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Failed to generate Prisma client" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Prisma client generated" -ForegroundColor Green
Set-Location ../..

Write-Host ""
Write-Host "[6/8] Running Python validation tests..." -ForegroundColor Yellow
Set-Location services/quant-engine
python test_regime_and_low_vol.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Python tests failed" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ All Python tests passed" -ForegroundColor Green
Set-Location ../..

Write-Host ""
Write-Host "[7/8] Checking database connection..." -ForegroundColor Yellow
Write-Host "  • To initialize database, run:" -ForegroundColor Gray
Write-Host "    cd apps/api" -ForegroundColor Gray
Write-Host "    npx prisma migrate dev" -ForegroundColor Gray
Write-Host "    cd ../worker" -ForegroundColor Gray
Write-Host "    npx tsx src/scripts/seed.ts" -ForegroundColor Gray

Write-Host ""
Write-Host "[8/8] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Start PostgreSQL and Redis (if not already running)" -ForegroundColor White
Write-Host ""
Write-Host "2. Initialize database:" -ForegroundColor White
Write-Host "   cd apps/api" -ForegroundColor Gray
Write-Host "   npx prisma migrate dev" -ForegroundColor Gray
Write-Host "   cd ../worker" -ForegroundColor Gray
Write-Host "   npx tsx src/scripts/seed.ts" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Start services (in separate terminals):" -ForegroundColor White
Write-Host "   Terminal 1: cd services/quant-engine && uvicorn app.main:app --reload --port 8811" -ForegroundColor Gray
Write-Host "   Terminal 2: cd apps/api && npm run dev" -ForegroundColor Gray
Write-Host "   Terminal 3: cd apps/worker && npm run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Verify installation:" -ForegroundColor White
Write-Host "   curl http://localhost:8811/health" -ForegroundColor Gray
Write-Host "   curl http://localhost:4000/health" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Run backtest with real data:" -ForegroundColor White
Write-Host "   cd services/quant-engine" -ForegroundColor Gray
Write-Host "   python -m app.backtest.regime_backtest --years 3" -ForegroundColor Gray
Write-Host ""
Write-Host "Full documentation: GETTING_STARTED.md" -ForegroundColor Yellow
Write-Host ""
