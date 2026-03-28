#!/bin/bash

################################################################################
#
# PolyFish Asset Conversion Script
# ================================
#
# This script automates the conversion of PolyFish assets for Three.js use:
# 1. Converts FBX models to glTF (.glb) format using Blender
# 2. Copies skybox textures from the Fermentation asset pack
#
# Usage:
#     ./convert_assets.sh
#
# Requirements:
#     - Blender installed and available in PATH
#     - Read/write access to PolyFish and PolyFish_ThreeJS directories
#
# Output:
#     - .glb files in: PolyFish_ThreeJS/assets/models/
#     - Skybox PNGs in: PolyFish_ThreeJS/assets/textures/skybox/
#
################################################################################

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "================================================================================"
echo "PolyFish Asset Conversion Script"
echo "================================================================================"
echo ""
echo "Project root: $PROJECT_ROOT"
echo ""

# Step 1: Convert FBX to glTF using Blender
echo "Step 1: Converting FBX files to glTF (.glb) format..."
echo "------------------------------------------------------------------------"

PYTHON_SCRIPT="$SCRIPT_DIR/convert_fbx_to_gltf.py"

if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo "ERROR: Conversion script not found: $PYTHON_SCRIPT"
    exit 1
fi

# Check if Blender is installed
if ! command -v blender &> /dev/null; then
    echo "ERROR: Blender is not installed or not in PATH"
    echo "Please install Blender and ensure it's available in your PATH"
    exit 1
fi

echo "Running Blender conversion..."
blender --background --python "$PYTHON_SCRIPT"

if [ $? -eq 0 ]; then
    echo "SUCCESS: FBX to glTF conversion completed"
else
    echo "WARNING: FBX to glTF conversion had issues (see above)"
fi

echo ""

# Step 2: Copy skybox textures
echo "Step 2: Copying skybox textures..."
echo "------------------------------------------------------------------------"

SKYBOX_SRC="$PROJECT_ROOT/PolyFish/Assets/Fermentation/textures/Skyboxes/underwater"
SKYBOX_DST="$PROJECT_ROOT/PolyFish_ThreeJS/assets/textures/skybox"

if [ ! -d "$SKYBOX_SRC" ]; then
    echo "WARNING: Skybox source directory not found: $SKYBOX_SRC"
else
    mkdir -p "$SKYBOX_DST"

    # Copy only PNG files (not .meta or .mat files)
    if cp "$SKYBOX_SRC"/*.png "$SKYBOX_DST"/ 2>/dev/null; then
        echo "SUCCESS: Copied skybox textures to: $SKYBOX_DST"
        ls -lh "$SKYBOX_DST"/*.png 2>/dev/null | awk '{print "  - " $9 " (" $5 ")"}'
    else
        echo "WARNING: No PNG skybox textures found in: $SKYBOX_SRC"
    fi
fi

echo ""

# Step 3: Information about particle texture
echo "Step 3: Particle texture information..."
echo "------------------------------------------------------------------------"

PARTICLE_TEX="$PROJECT_ROOT/PolyFish/Assets/Polyfish/textures/tri_particle_64.tga"

if [ -f "$PARTICLE_TEX" ]; then
    echo "Found particle texture: $PARTICLE_TEX"
    echo "File size: $(ls -lh "$PARTICLE_TEX" | awk '{print $5}')"
    echo ""
    echo "NOTE: This is a TGA file which needs to be converted to PNG or another"
    echo "      web-compatible format for use in Three.js."
    echo ""
    echo "To convert TGA to PNG, you can use ImageMagick:"
    echo "    convert tri_particle_64.tga tri_particle_64.png"
    echo ""
    echo "Or GIMP:"
    echo "    gimp tri_particle_64.tga"
else
    echo "Particle texture not found in expected location"
fi

echo ""
echo "================================================================================"
echo "Asset conversion complete!"
echo "================================================================================"
