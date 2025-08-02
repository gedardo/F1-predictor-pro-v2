# Script para instalar Docker Desktop en Windows

# Verificar si se está ejecutando como administrador
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Este script debe ejecutarse como administrador. Por favor, reinicia PowerShell como administrador." -ForegroundColor Red
    exit
}

# Verificar si WSL 2 está instalado
Write-Host "Verificando si WSL 2 está instalado..." -ForegroundColor Yellow
$wslCheck = wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "WSL 2 no está instalado correctamente. Instalando..." -ForegroundColor Yellow
    
    # Habilitar la característica WSL
    Write-Host "Habilitando la característica WSL..." -ForegroundColor Yellow
    dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
    
    # Habilitar la característica de Máquina Virtual
    Write-Host "Habilitando la característica de Máquina Virtual..." -ForegroundColor Yellow
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
    
    Write-Host "Se requiere reiniciar el sistema para completar la instalación de WSL." -ForegroundColor Red
    Write-Host "Por favor, reinicia tu sistema y vuelve a ejecutar este script." -ForegroundColor Red
    exit
}

# Verificar si Docker Desktop ya está instalado
Write-Host "Verificando si Docker Desktop ya está instalado..." -ForegroundColor Yellow
$dockerPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerPath) {
    Write-Host "Docker Desktop ya está instalado." -ForegroundColor Green
} else {
    # Descargar Docker Desktop
    Write-Host "Descargando Docker Desktop..." -ForegroundColor Yellow
    $dockerInstallerPath = "$env:TEMP\DockerDesktopInstaller.exe"
    Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $dockerInstallerPath
    
    # Instalar Docker Desktop
    Write-Host "Instalando Docker Desktop..." -ForegroundColor Yellow
    Start-Process -FilePath $dockerInstallerPath -ArgumentList "install --quiet" -Wait
    
    # Limpiar
    Remove-Item $dockerInstallerPath
    
    Write-Host "Docker Desktop ha sido instalado. Por favor, reinicia tu sistema." -ForegroundColor Green
    Write-Host "Después de reiniciar, inicia Docker Desktop desde el menú de inicio." -ForegroundColor Green
}

Write-Host "\nUna vez que Docker esté en funcionamiento, puedes construir y ejecutar la aplicación con los siguientes comandos:" -ForegroundColor Cyan
Write-Host "cd $PWD" -ForegroundColor White
Write-Host "docker build -t f1-predictor-pro ." -ForegroundColor White
Write-Host "docker run -p 8080:80 f1-predictor-pro" -ForegroundColor White
Write-Host "\nO usando Docker Compose:" -ForegroundColor Cyan
Write-Host "docker-compose up -d" -ForegroundColor White