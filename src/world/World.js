import * as THREE from 'three';
import { BVH } from '../physics/BVH.js';
import { MapGenerator, MAP, groundHeightAt } from './MapGenerator.js';
import { ClothSystem, CableSystem } from './ClothSystem.js';

/**
 * Owns everything static about the district: baked geometry, the collision
 * BVH, the wind-driven cloth and cable meshes, spawn points and cover data.
 */
export class World {
  constructor(materialFactory) {
    this.factory = materialFactory;
    this.scene = new THREE.Scene();
    this.scene.matrixAutoUpdate = false;
    this.meshes = [];
    this.time = 0;
  }

  build(seed) {
    const t0 = performance.now();
    const gen = new MapGenerator(seed);
    const data = gen.generate();
    const tGen = performance.now();

    this.data = data;
    this.soup = data.soup;
    this.bvh = new BVH(data.soup);
    const tBvh = performance.now();

    const staticMat = this.factory.create({ name: 'world-static' });
    this.staticMaterial = staticMat;
    for (const batch of data.batches) {
      const geo = batch.build();
      const mesh = new THREE.Mesh(geo, staticMat);
      mesh.name = batch.name;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }

    const clothMat = this.factory.create({ name: 'world-cloth', side: THREE.DoubleSide });
    this.cloth = new ClothSystem(data.cloth, clothMat);
    this.cables = new CableSystem(data.cables, clothMat);
    this.scene.add(this.cloth.mesh, this.cables.mesh);

    this.spawns = data.spawns;
    this.coverPoints = data.coverPoints;
    this.interiors = data.interiors;
    this.bounds = data.bounds;
    this.buildings = data.buildings;
    this.playBounds = data.playBounds;

    this.stats = {
      triangles: data.triangleCount,
      drawBatches: this.meshes.length + 2,
      vertices: this.meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0),
      genMs: tGen - t0,
      bvhMs: tBvh - tGen,
      cover: data.coverPoints.length,
      cloth: data.cloth.length,
      cables: data.cables.length
    };
    return this;
  }

  update(dt, time) {
    this.time = time;
    this.cloth.update(dt, time);
    this.cables.update(dt, time);
  }

  /** Drop a point onto the ground/geometry; used for spawns and AI placement. */
  groundAt(x, z) { return groundHeightAt(x, z); }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.cloth.dispose();
    this.cables.dispose();
  }
}

export { MAP, groundHeightAt };
