# Load the fastest practical vision model into LM Studio.
# Run from this repository or anywhere:
#   powershell -ExecutionPolicy Bypass -File scripts/lmstudio-fast.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/lmstudio-fast.ps1 -Model qwen/qwen2.5-vl-7b -Gpu 0.75 -Context 4096

param(
    [string]$Model = "qwen/qwen2.5-vl-3b",
    [string]$Gpu = "max",
    [int]$Context = 8192
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command lms -ErrorAction SilentlyContinue)) {
    throw "lms CLI not found. Open LM Studio and enable the CLI, then try again."
}

$installed = (lms ls 2>$null | Out-String)
if (-not $installed.Contains($Model)) {
    Write-Warning "Model $Model is not installed; falling back to qwen/qwen2.5-vl-7b."
    $Model = "qwen/qwen2.5-vl-7b"
    $Gpu = "0.75"
    $Context = 4096
}

Write-Host "Unloading other models..."
lms unload --all

Write-Host "Loading $Model (GPU $Gpu, context $Context, parallel 1)..."
lms load $Model --gpu $Gpu -c $Context --parallel 1 -y

Write-Host ""
lms ps
Write-Host ""
Write-Host "LM Studio API: http://localhost:1234/v1"
