const THREE = window.__game.THREE ?? null;
const vm = g.viewModel;
g.viewModel.root.updateMatrixWorld(true);

const box = (obj) => {
  if (!obj) return null;
  obj.geometry.computeBoundingBox();
  const b = obj.geometry.boundingBox;
  return {
    min: [b.min.x, b.min.y, b.min.z].map((v) => Math.round(v * 1000) / 1000),
    max: [b.max.x, b.max.y, b.max.z].map((v) => Math.round(v * 1000) / 1000),
    size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v) => Math.round(v * 1000) / 1000)
  };
};

const w = vm.weapon;
return {
  vmFovVertical: Math.round(g.vmCamera.fov * 10) / 10,
  aspect: Math.round(g.vmCamera.aspect * 100) / 100,
  weaponPos: w.position.toArray().map((v) => Math.round(v * 1000) / 1000),
  weaponRot: [w.rotation.x, w.rotation.y, w.rotation.z].map((v) => Math.round(v * 1000) / 1000),
  weaponScale: w.scale.toArray(),
  bodyLocal: box(vm.bodyMesh),
  muzzleLocal: vm.constructor.name,
  muzzleWorld: vm.muzzleWorld.toArray().map((v) => Math.round(v * 1000) / 1000),
  camPos: g.vmCamera.position.toArray().map((v) => Math.round(v * 1000) / 1000),
  near: g.vmCamera.near,
  children: vm.root.children.map((c) => c.name || c.type)
};
