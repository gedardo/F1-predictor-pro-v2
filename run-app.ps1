# Script para ejecutar la aplicación F1-Predictor-Pro

# Función para verificar si Node.js está instalado
function Check-NodeJS {
    try {
        $nodeVersion = node -v
        Write-Host "Node.js está instalado: $nodeVersion" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "Node.js no está instalado o no está en el PATH." -ForegroundColor Red
        return $false
    }
}

# Función para instalar dependencias
function Install-Dependencies {
    Write-Host "Instalando dependencias..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error al instalar dependencias." -ForegroundColor Red
        exit 1
    }
    Write-Host "Dependencias instaladas correctamente." -ForegroundColor Green
}

# Función para ejecutar en modo desarrollo
function Run-DevMode {
    Write-Host "Iniciando servidor de desarrollo..." -ForegroundColor Yellow
    npm run dev
}

# Función para construir para producción
function Build-Production {
    Write-Host "Construyendo para producción..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error al construir para producción." -ForegroundColor Red
        exit 1
    }
    Write-Host "Construcción completada correctamente." -ForegroundColor Green
}

# Función para previsualizar la versión de producción
function Preview-Production {
    Write-Host "Iniciando vista previa de producción..." -ForegroundColor Yellow
    npm run preview
}

# Verificar si Node.js está instalado
if (-not (Check-NodeJS)) {
    Write-Host "Por favor, instala Node.js desde https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Menú principal
function Show-Menu {
    Clear-Host
    Write-Host "=== F1-Predictor-Pro - Menú de Ejecución ===" -ForegroundColor Cyan
    Write-Host "1. Instalar dependencias" -ForegroundColor White
    Write-Host "2. Ejecutar en modo desarrollo" -ForegroundColor White
    Write-Host "3. Construir para producción" -ForegroundColor White
    Write-Host "4. Vista previa de producción" -ForegroundColor White
    Write-Host "5. Salir" -ForegroundColor White
    Write-Host "==========================================" -ForegroundColor Cyan
}

# Bucle principal
$running = $true
while ($running) {
    Show-Menu
    $choice = Read-Host "Selecciona una opción (1-5)"
    
    switch ($choice) {
        "1" { Install-Dependencies; pause }
        "2" { Run-DevMode; break }
        "3" { Build-Production; pause }
        "4" { Preview-Production; break }
        "5" { $running = $false }
        default { Write-Host "Opción no válida. Por favor, selecciona una opción del 1 al 5." -ForegroundColor Red; pause }
    }
}