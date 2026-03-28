# PolyFish Asset Conversion Script (PowerShell)
# Run from the PolyFish_ThreeJS/tools/ directory
#
# Usage:  .\convert_assets.ps1

$ErrorActionPreference = "Stop"

# --- Find Blender ---
$blenderPaths = @(
    "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
    "C:\Program Files\Blender Foundation\Blender\blender.exe",
    "$env:LOCALAPPDATA\Blender Foundation\Blender 4.5\blender.exe"
)

$blender = $null
foreach ($path in $blenderPaths) {
    $expanded = $ExecutionContext.InvokeCommand.ExpandString($path)
    if (Test-Path $expanded) {
        $blender = $expanded
        break
    }
}

# Also try PATH
if (-not $blender) {
    $blender = Get-Command blender -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $blender) {
    Write-Host "ERROR: Could not find Blender. Searched:" -ForegroundColor Red
    $blenderPaths | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "Please set the path manually:" -ForegroundColor Cyan
    Write-Host '  & "C:\path\to\blender.exe" --background --python convert_fbx_to_gltf.py'
    exit 1
}

Write-Host "Found Blender: $blender" -ForegroundColor Green

# --- Paths ---
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$threeJSDir = Split-Path -Parent $toolsDir
$projectRoot = Split-Path -Parent $threeJSDir

# --- Step 1: Convert FBX to glTF ---
Write-Host "`n=== Converting FBX meshes to glTF ===" -ForegroundColor Cyan
& $blender --background --python "$toolsDir\convert_fbx_to_gltf.py"

# --- Step 2: Copy skybox textures ---
Write-Host "`n=== Copying skybox textures ===" -ForegroundColor Cyan
$skyboxSrc = Join-Path $projectRoot "PolyFish\Assets\Fermentation\textures\Skyboxes\underwater"
$skyboxDst = Join-Path $threeJSDir "assets\textures\skybox"

if (-not (Test-Path $skyboxDst)) { New-Item -ItemType Directory -Path $skyboxDst -Force | Out-Null }

if (Test-Path $skyboxSrc) {
    Get-ChildItem "$skyboxSrc\*.png" | ForEach-Object {
        Copy-Item $_.FullName -Destination $skyboxDst -Force
        Write-Host "  Copied: $($_.Name)" -ForegroundColor Gray
    }
    Write-Host "Skybox textures copied." -ForegroundColor Green
} else {
    Write-Host "WARNING: Skybox source not found at $skyboxSrc" -ForegroundColor Yellow
}

# --- Step 3: Convert particle texture (if ImageMagick available) ---
Write-Host "`n=== Particle texture ===" -ForegroundColor Cyan
$particleSrc = Join-Path $projectRoot "PolyFish\Assets\Polyfish\textures\tri_particle_64.tga"
$particleDst = Join-Path $threeJSDir "assets\textures\particle.png"

if (Test-Path $particleSrc) {
    $magick = Get-Command magick -ErrorAction SilentlyContinue
    if ($magick) {
        & magick $particleSrc $particleDst
        Write-Host "Converted particle texture to PNG." -ForegroundColor Green
    } else {
        Write-Host "ImageMagick not found. To convert the particle texture manually:" -ForegroundColor Yellow
        Write-Host "  magick `"$particleSrc`" `"$particleDst`"" -ForegroundColor Gray
    }
} else {
    Write-Host "Particle texture not found at $particleSrc" -ForegroundColor Yellow
}

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  cd $threeJSDir"
Write-Host "  npm install"
Write-Host "  npm run dev"
