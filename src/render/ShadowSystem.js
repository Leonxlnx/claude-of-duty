import * as THREE from 'three';

const SHADOW_VERT = /* glsl */`
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
void main(){
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const SHADOW_SKINNED_VERT = /* glsl */`
precision highp float;
in vec3 position;
in float aBone;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uBones[16];
void main(){
  gl_Position = projectionMatrix * viewMatrix * uBones[int(aBone + 0.5)] * vec4(position, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */`
precision highp float;
layout(location = 0) out vec4 outDepth;
void main(){
  outDepth = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
`;

/**
 * Cascaded sun shadows into a sampler2DArray.
 *
 * Each cascade is fitted to a bounding sphere of its frustum slice, which keeps
 * the extent constant as the camera rotates, and the light-space origin is
 * snapped to whole texels so the shadow edges do not crawl while walking.
 */
export class ShadowSystem {
  constructor(renderer, { resolution = 2048, cascades = 4, maxDistance = 110, lambda = 0.82 } = {}) {
    this.renderer = renderer;
    this.resolution = resolution;
    this.cascadeCount = cascades;
    this.maxDistance = maxDistance;
    this.lambda = lambda;

    this.target = new THREE.WebGLArrayRenderTarget(resolution, resolution, cascades, {
      format: THREE.RedFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      generateMipmaps: false
    });
    this.target.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.target.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      side: THREE.FrontSide
    });

    this._swapped = [];
    this.cameras = [];
    this.matrices = [];
    for (let i = 0; i < cascades; i++) {
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
      cam.matrixAutoUpdate = false;
      this.cameras.push(cam);
      this.matrices.push(new THREE.Matrix4());
    }
    this.splits = new THREE.Vector4();
    this._lastSnap = [];
    for (let i = 0; i < cascades; i++) this._lastSnap.push(new THREE.Vector3());

    // Dedicated tiny cascade covering only the first-person weapon, so the
    // viewmodel self-shadows without projecting a giant gun onto the street.
    this.viewmodelTarget = new THREE.WebGLRenderTarget(1024, 1024, {
      format: THREE.RedFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true
    });
    this.viewmodelCamera = new THREE.OrthographicCamera(-0.6, 0.6, 0.6, -0.6, 0.05, 6);
    this.viewmodelCamera.matrixAutoUpdate = false;
    this.viewmodelMatrix = new THREE.Matrix4();
  }

  setResolution(res) {
    if (res === this.resolution) return;
    this.resolution = res;
    this.target.setSize(res, res, this.cascadeCount);
  }

  /** Practical split scheme blended between uniform and logarithmic. */
  computeSplits(near, far) {
    const n = Math.max(near, 0.1);
    const f = Math.min(far, this.maxDistance);
    const out = [];
    for (let i = 1; i <= this.cascadeCount; i++) {
      const p = i / this.cascadeCount;
      const log = n * Math.pow(f / n, p);
      const uni = n + (f - n) * p;
      out.push(this.lambda * log + (1 - this.lambda) * uni);
    }
    this.splits.set(out[0], out[1] ?? out[0], out[2] ?? out[1] ?? out[0], out[3] ?? out[2] ?? out[0]);
    return out;
  }

  update(camera, sunDirection) {
    const splits = this.computeSplits(camera.near, this.maxDistance);
    const invView = camera.matrixWorld;
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const tanHalfH = tanHalfV * camera.aspect;

    let prevSplit = camera.near;
    for (let c = 0; c < this.cascadeCount; c++) {
      const nearD = prevSplit;
      const farD = splits[c];
      prevSplit = farD;

      // frustum-slice bounding sphere in world space (rotation invariant)
      const xn = nearD * tanHalfH, yn = nearD * tanHalfV;
      const xf = farD * tanHalfH, yf = farD * tanHalfV;
      _corners[0].set(-xn, -yn, -nearD); _corners[1].set(xn, -yn, -nearD);
      _corners[2].set(-xn, yn, -nearD); _corners[3].set(xn, yn, -nearD);
      _corners[4].set(-xf, -yf, -farD); _corners[5].set(xf, -yf, -farD);
      _corners[6].set(-xf, yf, -farD); _corners[7].set(xf, yf, -farD);

      _center.set(0, 0, 0);
      for (let i = 0; i < 8; i++) {
        _corners[i].applyMatrix4(invView);
        _center.add(_corners[i]);
      }
      _center.multiplyScalar(1 / 8);
      let radius = 0;
      for (let i = 0; i < 8; i++) radius = Math.max(radius, _center.distanceTo(_corners[i]));
      radius = Math.ceil(radius * 16) / 16;

      const cam = this.cameras[c];
      const texelSize = (radius * 2) / this.resolution;

      // build light basis
      _lightDir.copy(sunDirection).normalize();
      _up.set(0, 1, 0);
      if (Math.abs(_lightDir.dot(_up)) > 0.98) _up.set(1, 0, 0);
      _eye.copy(_center).addScaledVector(_lightDir, radius + 60);
      _m.lookAt(_eye, _center, _up);
      _q.setFromRotationMatrix(_m);

      // snap the centre to whole shadow texels in light space
      _lightSpace.makeRotationFromQuaternion(_q).invert();
      _snapped.copy(_center).applyMatrix4(_lightSpace);
      _snapped.x = Math.floor(_snapped.x / texelSize) * texelSize;
      _snapped.y = Math.floor(_snapped.y / texelSize) * texelSize;
      _lightSpaceInv.makeRotationFromQuaternion(_q);
      _snapped.applyMatrix4(_lightSpaceInv);

      _eye.copy(_snapped).addScaledVector(_lightDir, radius + 60);
      cam.position.copy(_eye);
      cam.quaternion.copy(_q);
      cam.left = -radius; cam.right = radius;
      cam.top = radius; cam.bottom = -radius;
      cam.near = 0.5;
      cam.far = radius * 2 + 140;
      cam.updateProjectionMatrix();
      cam.updateMatrix();
      cam.matrixWorld.copy(cam.matrix);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      this.matrices[c].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    }
  }

  /**
   * Skinned depth material for characters. It shares the bone uniform object
   * with the character's shading material, so the shadow always matches the
   * pose without any extra bookkeeping.
   */
  createSkinnedMaterial(boneUniform) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHADOW_SKINNED_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { uBones: boneUniform },
      side: THREE.FrontSide
    });
  }

  /**
   * `scene.overrideMaterial` cannot express "everything flat, except the
   * skinned meshes", so depth materials are swapped in per mesh instead.
   * Meshes opt out of casting by setting `userData.noShadow`.
   */
  _swapIn(scene) {
    this._swapped.length = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.userData.noShadow) { this._swapped.push([o, o.material, true]); o.visible = false; return; }
      this._swapped.push([o, o.material, false]);
      o.material = o.userData.shadowMaterial || this.material;
    });
  }

  _swapOut() {
    for (const [mesh, mat, hidden] of this._swapped) {
      mesh.material = mat;
      if (hidden) mesh.visible = true;
    }
    this._swapped.length = 0;
  }

  render(scene, sunDirection) {
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    this._swapIn(scene);
    renderer.autoClear = true;
    renderer.setClearColor(0xffffff, 1);

    for (let c = 0; c < this.cascadeCount; c++) {
      renderer.setRenderTarget(this.target, c);
      renderer.clear(true, true, false);
      renderer.render(scene, this.cameras[c]);
    }

    this._swapOut();
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    void sunDirection;
  }

  /** Weapon-only cascade fitted around the viewmodel bounds. */
  renderViewmodel(scene, sunDirection, center) {
    const renderer = this.renderer;
    _lightDir.copy(sunDirection).normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_lightDir.dot(_up)) > 0.98) _up.set(1, 0, 0);
    _eye.copy(center).addScaledVector(_lightDir, 2.0);
    _m.lookAt(_eye, center, _up);
    const cam = this.viewmodelCamera;
    cam.position.copy(_eye);
    cam.quaternion.setFromRotationMatrix(_m);
    cam.updateMatrix();
    cam.matrixWorld.copy(cam.matrix);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.updateProjectionMatrix();
    this.viewmodelMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    // The viewmodel root is a Group, and `overrideMaterial` is only honoured on
    // a Scene, so the depth material is swapped in per mesh here too.
    this._swapIn(scene);
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(this.viewmodelTarget);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    this._swapOut();
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    this.target.dispose();
    this.viewmodelTarget.dispose();
    this.material.dispose();
  }
}

const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const _center = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _lightDir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _lightSpace = new THREE.Matrix4();
const _lightSpaceInv = new THREE.Matrix4();
const _snapped = new THREE.Vector3();
