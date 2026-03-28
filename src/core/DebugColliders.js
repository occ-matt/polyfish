import * as THREE from 'three';

let physicsProxy = null;

class DebugColliders {
  constructor() {
    this.enabled = false;
    this.scene = null;
    this._entries = new Map(); // entityRef -> { group: THREE.Group, type: string, updateFn }
  }

  init(scene) {
    this.scene = scene;
  }

  setPhysicsProxy(proxy) {
    physicsProxy = proxy;
  }

  toggle() {
    this.enabled = !this.enabled;
    // Materialize any deferred hulls now that debug is being toggled on
    if (this.enabled) {
      for (const [entityRef, entry] of this._entries) {
        if (entry.type === 'hull_deferred') {
          this._createHullNow(entityRef, entry._radius, entry._color);
        }
      }
    }
    for (const entry of this._entries.values()) {
      if (entry._setVisible) {
        entry._setVisible(this.enabled);
      } else {
        entry.group.visible = this.enabled;
      }
    }
    // Debug colliders toggled
  }

  // Add a capsule wireframe for a creature (single body)
  // shapeRotation: optional Euler-like { x, y, z } applied to the capsule group itself
  addCapsule(entityRef, halfHeight, radius, color = 0xff4444, shapeRotation = null) {
    if (!this.scene) return;
    this.remove(entityRef); // prevent orphaned meshes if called twice
    const group = this._makeCapsule(halfHeight, radius, color);
    if (shapeRotation) {
      group.rotation.set(shapeRotation.x || 0, shapeRotation.y || 0, shapeRotation.z || 0);
    }
    // Wrap in an outer group so we can copy mesh position/quaternion on the outer,
    // while keeping the shape rotation on the inner group.
    const outer = new THREE.Group();
    outer.add(group);
    outer.visible = this.enabled;
    this.scene.add(outer);
    this._entries.set(entityRef, {
      group: outer,
      type: 'capsule',
      updateFn: () => {
        outer.position.copy(entityRef.mesh.position);
        outer.quaternion.copy(entityRef.mesh.quaternion);
      }
    });
  }

  // Add ragdoll chain (array of {bone, nextBone, halfHeight, radius})
  // Each capsule spans from bone to nextBone, oriented along that direction.
  addRagdollChain(entityRef, boneData, color = 0x44ff44) {
    if (!this.scene) return;
    const _p1 = new THREE.Vector3();
    const _p2 = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);

    const capsules = [];
    for (const { bone, nextBone, halfHeight, radius, tipExtension } of boneData) {
      const cap = this._makeCapsule(halfHeight, radius, color);
      cap.visible = this.enabled;
      this.scene.add(cap);
      capsules.push({ mesh: cap, bone, nextBone, tipExtension: tipExtension || 0 });
    }
    this._entries.set(entityRef, {
      group: { visible: this.enabled },
      type: 'ragdollChain',
      capsules,
      updateFn: () => {
        for (const { mesh, bone, nextBone, tipExtension } of capsules) {
          bone.getWorldPosition(_p1);
          if (nextBone) {
            nextBone.getWorldPosition(_p2);
          } else {
            _dir.set(0, 1, 0);
            _p2.copy(_p1).addScaledVector(_dir, tipExtension || 1.0);
          }
          // If bones are co-located (creatures), use entity mesh forward as fallback
          _dir.subVectors(_p2, _p1);
          if (_dir.lengthSq() < 0.001) {
            // Bones at same position — align capsule with mesh forward
            _dir.set(0, 0, 1);
            if (entityRef.mesh) _dir.applyQuaternion(entityRef.mesh.quaternion);
            mesh.position.copy(_p1);
          } else {
            mesh.position.lerpVectors(_p1, _p2, 0.5);
            _dir.normalize();
          }
          mesh.quaternion.setFromUnitVectors(_up, _dir);
        }
      },
      _setVisible(v) {
        for (const { mesh } of capsules) mesh.visible = v;
      }
    });
  }

  // Add ragdoll chain that reads positions/rotations directly from physics proxy slots.
  // bodyData: array of { bodyID (slot), halfHeight, radius }
  addJoltRagdollChain(entityRef, bodyData, color = 0xff4444) {
    if (!this.scene) return;
    const _up = new THREE.Vector3(0, 1, 0);

    const capsules = [];
    for (const { bodyID, halfHeight, radius } of bodyData) {
      const cap = this._makeCapsule(halfHeight, radius, color);
      cap.visible = this.enabled;
      this.scene.add(cap);
      capsules.push({ mesh: cap, slot: bodyID });
    }
    this._entries.set(entityRef, {
      group: { visible: this.enabled },
      type: 'joltRagdollChain',
      capsules,
      updateFn: () => {
        if (!physicsProxy) return;
        for (const { mesh, slot } of capsules) {
          const p = physicsProxy.getPosition(slot);
          const r = physicsProxy.getRotation(slot);
          mesh.position.set(p.x, p.y, p.z);
          mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
      },
      _setVisible(v) {
        for (const { mesh } of capsules) mesh.visible = v;
      }
    });
  }

  // Add octahedron hull wireframe for seed
  // Lazy: stores params but only creates the mesh when debug is toggled on.
  addHull(entityRef, radius, color = 0xffaa00) {
    if (!this.scene) return;
    if (this.enabled) {
      // Debug already on — create immediately
      this._createHullNow(entityRef, radius, color);
    } else {
      // Defer: store params, create mesh on toggle()
      this._entries.set(entityRef, {
        group: { visible: false },
        type: 'hull_deferred',
        _radius: radius,
        _color: color,
        updateFn: () => {},
      });
    }
  }

  _createHullNow(entityRef, radius, color) {
    const geo = new THREE.OctahedronGeometry(radius, 0);
    const mat = new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity: 0.5, depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 999;
    mesh.visible = this.enabled;
    this.scene.add(mesh);
    this._entries.set(entityRef, {
      group: mesh,
      type: 'hull',
      updateFn: () => {
        mesh.position.copy(entityRef.mesh.position);
        mesh.quaternion.copy(entityRef.mesh.quaternion);
      }
    });
  }

  // Remove ALL debug visuals (call during full restart/teardown)
  removeAll() {
    const refs = [...this._entries.keys()];
    for (const ref of refs) {
      this.remove(ref);
    }
  }

  // Remove debug visual for an entity
  remove(entityRef) {
    const entry = this._entries.get(entityRef);
    if (!entry) return;
    if (entry.capsules) {
      // Ragdoll chain — remove individual capsules
      for (const { mesh } of entry.capsules) this.scene.remove(mesh);
    } else {
      this.scene.remove(entry.group);
    }
    this._entries.delete(entityRef);
  }

  // Sync all wireframes to entity positions -- call every frame
  update() {
    if (!this.enabled) return;
    for (const entry of this._entries.values()) {
      entry.updateFn();
    }
  }

  // Build a capsule wireframe (cylinder + hemisphere caps)
  _makeCapsule(halfHeight, radius, color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity: 0.5, depthTest: false,
    });

    const cylGeo = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 10, 1, true);
    group.add(new THREE.Mesh(cylGeo, mat));

    const capGeo = new THREE.SphereGeometry(radius, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const topCap = new THREE.Mesh(capGeo, mat);
    topCap.position.y = halfHeight;
    group.add(topCap);

    const bottomCap = new THREE.Mesh(capGeo, mat);
    bottomCap.position.y = -halfHeight;
    bottomCap.rotation.x = Math.PI;
    group.add(bottomCap);

    group.renderOrder = 999;
    return group;
  }
}

export default new DebugColliders();
