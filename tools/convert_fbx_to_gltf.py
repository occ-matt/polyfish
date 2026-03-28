#!/usr/bin/env python3
"""
Blender FBX to glTF Batch Conversion Script for PolyFish
=========================================================

Converts FBX files to glTF (.glb) preserving vertex colors, skeletons, and animations.

Usage (run from the PolyFish_ThreeJS/tools/ directory):

    Windows (PowerShell):
        & "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe" --background --python convert_fbx_to_gltf.py

    Ubuntu (snap):
        snap run blender --background --python convert_fbx_to_gltf.py

    Ubuntu (if on PATH):
        blender --background --python convert_fbx_to_gltf.py

Output: .glb files in PolyFish_ThreeJS/assets/models/
"""

import os
import sys
import bpy
from pathlib import Path


def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in bpy.data.collections:
        bpy.data.collections.remove(collection)


def get_project_root():
    """Get the SillyStuff_p4 root (parent of PolyFish_ThreeJS)."""
    script_dir = Path(__file__).resolve().parent  # tools/
    return script_dir.parent.parent                # SillyStuff_p4/


def import_fbx(fbx_path):
    """Import an FBX file into the scene."""
    print(f"\n[IMPORT] Loading: {fbx_path}")
    if not os.path.exists(fbx_path):
        print(f"[ERROR] File not found: {fbx_path}")
        return False
    try:
        bpy.ops.import_scene.fbx(filepath=str(fbx_path))
        print(f"[OK] Imported")
        return True
    except Exception as e:
        print(f"[ERROR] Import failed: {e}")
        return False


def apply_unit_scale():
    """
    Fix FBX centimeter→meter scale mismatch.
    FBX files use centimeters, glTF uses meters. Blender's FBX importer
    puts a 0.01 scale on armatures/empties to compensate, which makes
    models appear 100× too small in Three.js.
    This function applies the scale on all root objects so the transform
    is baked into the mesh and the exported glTF has scale (1,1,1).
    """
    bpy.ops.object.select_all(action='SELECT')
    # Apply scale on all selected objects
    try:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        print("[OK] Applied unit scale to all objects")
    except RuntimeError as e:
        # Some objects (e.g. empties) may fail; that's fine
        print(f"[WARN] transform_apply partial: {e}")

    bpy.ops.object.select_all(action='DESELECT')


def export_gltf(fbx_path, output_dir):
    """Export the scene as binary glTF."""
    filename = Path(fbx_path).stem
    output_path = str(Path(output_dir) / f"{filename}.glb")
    print(f"[EXPORT] Saving: {output_path}")
    # Blender 4.5 glTF export: vertex color param is now a string enum.
    # Try variations in order of likelihood.
    attempts = [
        # Blender 4.5+: export_vertex_color takes a string enum
        {'export_vertex_color': 'ACTIVE'},
        # Blender 4.2-4.4: might use bool
        {'export_colors': True},
        # No explicit vertex color param (included by default)
        {},
    ]

    base_args = {
        'filepath': output_path,
        'export_format': 'GLB',
        'export_skins': True,
        'export_animations': True,
        'export_apply': True,
    }

    for extra_args in attempts:
        try:
            bpy.ops.export_scene.gltf(**{**base_args, **extra_args})
            label = str(extra_args) if extra_args else 'defaults'
            print(f"[OK] Exported: {output_path} ({label})")
            return True
        except (TypeError, RuntimeError) as e:
            continue  # Try next set of params

    print(f"[ERROR] All export attempts failed for: {output_path}")
    return False


def main():
    print("=" * 70)
    print("PolyFish FBX -> glTF Batch Conversion")
    print("=" * 70)

    project_root = get_project_root()
    output_dir = project_root / "PolyFish_ThreeJS" / "assets" / "models"
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n[INFO] Project root: {project_root}")
    print(f"[INFO] Output dir:   {output_dir}")

    fbx_files = [
        "PolyFish/Assets/Fermentation/Meshes_/fish_rigged.fbx",
        "PolyFish/Assets/Fermentation/Meshes_/dolphin_rigged.fbx",
        "PolyFish/Assets/Fermentation/Meshes_/manatee_rigged.fbx",
        "PolyFish/Assets/Fermentation/Meshes_/kelp_rigged.fbx",
        "PolyFish/Assets/Fermentation/Meshes_/sphere_fancy.fbx",
        "PolyFish/Assets/Fermentation/Meshes_/pointy_thing_02.fbx",
        "PolyFish/Assets/Fermentation/Meshes_/sphere_fancy_lod_01.fbx",
        "PolyFish/Assets/Polyfish/Meshes/polyFish_logo.fbx",
        "PolyFish/Assets/SillyLibrary/Meshes/Logo.fbx",
    ]

    converted = 0
    failed = 0

    for fbx_file in fbx_files:
        fbx_path = project_root / fbx_file
        clear_scene()
        if import_fbx(str(fbx_path)):
            apply_unit_scale()
            if export_gltf(str(fbx_path), str(output_dir)):
                converted += 1
            else:
                failed += 1
        else:
            failed += 1

    print("\n" + "=" * 70)
    print(f"DONE: {converted} converted, {failed} failed out of {len(fbx_files)}")
    print("=" * 70)

    bpy.ops.wm.quit_blender()


if __name__ == "__main__":
    main()
