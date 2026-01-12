# NeuroByte Installer for Windows
# Run: iwr -useb https://neurobyte.dev/install.ps1 | iex

$ErrorActionPreference = "Stop"

$NEUROBYTE_VERSION = if ($env:NEUROBYTE_VERSION) { $env:NEUROBYTE_VERSION } else { "latest" }
$INSTALL_DIR = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\.neurobyte" }

function Write-Banner {
    Write-Host @"
  _   _                      ____        _
 | \ | | ___ _   _ _ __ ___ | __ ) _   _| |_ ___
 |  \| |/ _ \ | | | '__/ _ \|  _ \| | | | __/ _ \
 | |\  |  __/ |_| | | | (_) | |_) | |_| | ||  __/
 |_| \_|\___|\__,_|_|  \___/|____/ \__, |\__\___|
                                   |___/
"@ -ForegroundColor Blue
    Write-Host "  AI-Powered Local Coding Assistant`n" -ForegroundColor Cyan
}

function Get-DeviceTier {
    $totalMem = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB

    if ($totalMem -ge 32) { return "ultra" }
    elseif ($totalMem -ge 16) { return "high" }
    elseif ($totalMem -ge 8) { return "medium" }
    else { return "low" }
}

function Get-RecommendedModel {
    param([string]$Tier)

    switch ($Tier) {
        "ultra"  { return "qwen2.5:14b" }
        "high"   { return "qwen2.5:7b" }
        "medium" { return "qwen2.5:3b" }
        "low"    { return "qwen2.5:0.5b" }
        default  { return "qwen2.5:3b" }
    }
}

function Test-OllamaInstalled {
    try {
        $null = Get-Command ollama -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Install-Ollama {
    Write-Host "[INFO] Installing Ollama..." -ForegroundColor Blue

    # Download Ollama installer
    $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
    $installerPath = "$env:TEMP\OllamaSetup.exe"

    Write-Host "[INFO] Downloading Ollama installer..." -ForegroundColor Blue
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath

    Write-Host "[INFO] Running Ollama installer..." -ForegroundColor Blue
    Start-Process -FilePath $installerPath -Wait

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-OllamaInstalled) {
        Write-Host "[SUCCESS] Ollama installed successfully!" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Please restart your terminal and run this script again" -ForegroundColor Yellow
        exit 0
    }
}

function Start-OllamaService {
    Write-Host "[INFO] Starting Ollama service..." -ForegroundColor Blue

    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden

    # Wait for Ollama to start
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:11434/api/version" -TimeoutSec 1
            Write-Host "[SUCCESS] Ollama is running!" -ForegroundColor Green
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    Write-Host "[WARN] Ollama may not be running. Start it manually with: ollama serve" -ForegroundColor Yellow
}

function Install-Model {
    param([string]$Model)

    Write-Host "[INFO] Pulling model: $Model (this may take a while)..." -ForegroundColor Blue
    & ollama pull $Model
    Write-Host "[SUCCESS] Model $Model pulled successfully!" -ForegroundColor Green
}

function Install-NeuroByte {
    Write-Host "[INFO] Installing NeuroByte Core..." -ForegroundColor Blue

    # Create directories
    New-Item -ItemType Directory -Force -Path "$INSTALL_DIR\bin" | Out-Null

    $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "x86" }
    $binaryName = "neurobyte-server.exe"
    $downloadUrl = "https://github.com/neurobyte/neurobyte/releases/download/$NEUROBYTE_VERSION/windows-$arch/$binaryName"

    try {
        Write-Host "[INFO] Downloading NeuroByte Core..." -ForegroundColor Blue
        Invoke-WebRequest -Uri $downloadUrl -OutFile "$INSTALL_DIR\bin\$binaryName"
    } catch {
        Write-Host "[WARN] Pre-built binary not available. Please build from source." -ForegroundColor Yellow
        Write-Host "See: https://github.com/neurobyte/neurobyte#building-from-source" -ForegroundColor Yellow
    }

    # Add to PATH
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$INSTALL_DIR\bin*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$INSTALL_DIR\bin", "User")
        $env:Path += ";$INSTALL_DIR\bin"
    }

    Write-Host "[SUCCESS] NeuroByte Core installed to $INSTALL_DIR" -ForegroundColor Green
}

function New-Config {
    param([string]$Tier, [string]$Model)

    New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.neurobyte" | Out-Null

    $config = @{
        ollama_url = "http://127.0.0.1:11434"
        default_model = $Model
        auto_start_ollama = $true
        auto_pull_model = $true
        max_context_length = 8192
        temperature = 0.7
        top_p = 0.9
        streaming = $true
        device_tier = $Tier
    } | ConvertTo-Json

    $config | Out-File -FilePath "$env:USERPROFILE\.neurobyte\config.json" -Encoding UTF8

    Write-Host "[SUCCESS] Configuration saved" -ForegroundColor Green
}

function Install-VSCodeExtension {
    Write-Host "[INFO] Installing VS Code extension..." -ForegroundColor Blue

    try {
        & code --install-extension neurobyte.neurobyte 2>$null
        Write-Host "[SUCCESS] VS Code extension installed!" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not install extension. Install manually from VS Code." -ForegroundColor Yellow
    }
}

# Main
Write-Banner

$tier = Get-DeviceTier
$model = Get-RecommendedModel -Tier $tier

Write-Host "[INFO] Detected device tier: $tier" -ForegroundColor Blue
Write-Host "[INFO] Recommended model: $model`n" -ForegroundColor Blue

# Step 1: Install Ollama
if (Test-OllamaInstalled) {
    Write-Host "[SUCCESS] Ollama is already installed" -ForegroundColor Green
} else {
    $response = Read-Host "Ollama is not installed. Install it now? [Y/n]"
    if ($response -eq "" -or $response -eq "Y" -or $response -eq "y") {
        Install-Ollama
    }
}

# Step 2: Start Ollama
try {
    $null = Invoke-RestMethod -Uri "http://localhost:11434/api/version" -TimeoutSec 1
} catch {
    Start-OllamaService
}

# Step 3: Pull model
if (Test-OllamaInstalled) {
    $models = & ollama list 2>$null
    if ($models -notlike "*$model*") {
        $response = Read-Host "Download recommended model ($model)? [Y/n]"
        if ($response -eq "" -or $response -eq "Y" -or $response -eq "y") {
            Install-Model -Model $model
        }
    } else {
        Write-Host "[SUCCESS] Model $model is already available" -ForegroundColor Green
    }
}

# Step 4: Install NeuroByte
Install-NeuroByte

# Step 5: Create config
New-Config -Tier $tier -Model $model

# Step 6: VS Code extension
$response = Read-Host "Install VS Code extension? [Y/n]"
if ($response -eq "" -or $response -eq "Y" -or $response -eq "y") {
    Install-VSCodeExtension
}

Write-Host "`n[SUCCESS] NeuroByte installation complete!" -ForegroundColor Green
Write-Host @"

Next steps:
  1. Open VS Code and look for NeuroByte in the sidebar
  2. Start chatting with your local AI assistant!

Enjoy coding with NeuroByte!
"@
