import * as THREE from 'three';
import { FullscreenPass, fullscreenCamera } from '../render/FullscreenPass.js';
import { GLSL_NOISE } from '../render/shaders/noise.glsl.js';
import { SURFACE } from '../physics/BVH.js';

/**
 * Every surface texture in the game is synthesised on the GPU at startup into
 * three tileable 2D texture arrays (albedo / normal+height / ORM). One array
 * means the whole static world draws with a single shader and a per-vertex
 * layer index, which keeps draw calls low while still giving each surface its
 * own macro, meso and micro detail.
 */

export const LAYER = {
  PLASTER_BEIGE: 0,
  PLASTER_WHITE: 1,
  CONCRETE: 2,
  BRICK: 3,
  STUCCO_BLUE: 4,
  STUCCO_TERRACOTTA: 5,
  METAL_PAINTED: 6,
  METAL_RUST: 7,
  WOOD: 8,
  ASPHALT: 9,
  SAND: 10,
  FABRIC: 11,
  SANDBAG: 12,
  TILE: 13,
  GUNMETAL: 14,
  GRAVEL: 15,
  POLYMER: 16,
  GEAR_CLOTH: 17,
  PLASTER_PEACH: 18,
  CORRUGATED: 19
};

export const LAYER_COUNT = 20;

/** Physics surface class for each visual layer. */
export const LAYER_SURFACE = [
  SURFACE.PLASTER, SURFACE.PLASTER, SURFACE.CONCRETE, SURFACE.BRICK,
  SURFACE.PLASTER, SURFACE.PLASTER, SURFACE.METAL, SURFACE.METAL,
  SURFACE.WOOD, SURFACE.CONCRETE, SURFACE.SAND, SURFACE.FABRIC,
  SURFACE.SANDBAG, SURFACE.TILE, SURFACE.METAL, SURFACE.DIRT,
  SURFACE.RUBBER, SURFACE.FABRIC, SURFACE.PLASTER, SURFACE.METAL
];

const GEN_FRAG = /* glsl */`
${GLSL_NOISE}

// Specialised per layer at build time. Keeping the layer as a uniform means one
// program has to contain all twenty materials, and an inlined twenty-way branch
// over this much noise is enough to hang a driver shader compiler for minutes.
#ifndef GEN_LAYER
#define GEN_LAYER 0
#endif
const int uLayer = GEN_LAYER;

uniform int uOutput;   // 0 albedo, 1 normal, 2 orm, 3 height
uniform float uPeriod;
uniform sampler2D uHeight;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

const float PI = 3.14159265;

// ---------------------------------------------------------------- helpers
float bricks(vec2 uv, float rows, float cols, out vec2 cellId, out vec2 cellUv, float offset){
  vec2 p = uv * vec2(cols, rows);
  float row = floor(p.y);
  p.x += mod(row, 2.0) * offset;
  cellId = vec2(floor(p.x), row);
  cellUv = fract(p);
  vec2 m = min(cellUv, 1.0-cellUv);
  return min(m.x * cols * 0.09, m.y * rows * 0.09);
}

float streaks(vec2 uv, float freq, float len){
  float s = tfbm(vec2(uv.x*freq, uv.y*freq*0.14), uPeriod*freq, 4, 0.55);
  return smoothstep(0.45, 0.9, s) * smoothstep(0.0, len, uv.y);
}

// Thin crack lines that only appear where the damage mask says so, otherwise
// the Worley net reads as flagstone paving instead of weathering.
float cracks(vec2 uv, float scale){
  vec3 w = tworley(uv*scale, uPeriod*scale);
  float edge = w.y - w.x;
  float line = 1.0 - smoothstep(0.0, 0.020, edge);
  float mask = smoothstep(0.44, 0.74, tfbm(uv*2.3, uPeriod*2.3, 3, 0.6));
  float branch = smoothstep(0.35, 0.62, tfbm(uv*11.0, uPeriod*11.0, 3, 0.55));
  return line * mask * branch;
}

float chips(vec2 uv, float scale, float thresh){
  vec3 w = tworley(uv*scale, uPeriod*scale);
  return step(w.z, thresh) * (1.0 - smoothstep(0.0, 0.28, w.x));
}

/**
 * Same spall pattern, but also reporting the shadowed lip around the break.
 * Without the lip an exposed patch reads as a splash of paint rather than a
 * piece of render that has fallen off the wall.
 */
float chips(vec2 uv, float scale, float thresh, out float rim){
  vec3 w = tworley(uv*scale, uPeriod*scale);
  float inside = step(w.z, thresh);
  rim = inside * smoothstep(0.20, 0.28, w.x) * (1.0 - smoothstep(0.28, 0.38, w.x));
  return inside * (1.0 - smoothstep(0.0, 0.28, w.x));
}

/**
 * Sand aggregate in the render coat. Shared between the height field and the
 * albedo so the relief that catches the sun also shows as tone — dust settles
 * in the pits while the raised grains scour lighter.
 */
float plasterGrain(vec2 uv){
  return tfbm(uv*104.0, uPeriod*104.0, 2, 0.5);
}

// ---------------------------------------------------------------- height
float heightFn(vec2 uv, int layer){
  if(layer == 0 || layer == 1 || layer == 4 || layer == 5 || layer == 18){
    // plaster / stucco: gentle undulation, patch edges, cracks, chipped corners
    float h = tfbm(uv*6.0, uPeriod*6.0, 5, 0.55)*0.5;
    // Float marks left by the trowel — stretched along the sweep direction, so
    // a wall catches the sun in bands rather than reading as flat paint.
    h += tfbm(vec2(uv.x*8.0, uv.y*21.0), uPeriod*21.0, 3, 0.5)*0.15;
    h += tfbm(uv*36.0, uPeriod*36.0, 3, 0.5)*0.14;
    // Sand aggregate. This is the micro relief that actually sells plaster at
    // the distance a player fights from; without it the normal map is flat.
    h += plasterGrain(uv)*0.115;
    h += (1.0 - smoothstep(0.0, 0.55, tworley(uv*150.0, uPeriod*150.0).x))*0.06;
    float patchMask = smoothstep(0.52,0.56, tfbm(uv*3.0, uPeriod*3.0, 3, 0.6));
    h -= patchMask*0.10;
    h -= cracks(uv, 9.0)*0.16;
    h -= chips(uv, 17.0, 0.14)*0.22;
    return h;
  }
  if(layer == 2){ // concrete
    float h = tfbm(uv*5.0, uPeriod*5.0, 5, 0.5)*0.5;
    h += tfbm(uv*40.0, uPeriod*40.0, 3, 0.5)*0.2;
    h += tfbm(uv*118.0, uPeriod*118.0, 2, 0.5)*0.1;   // cement grain
    h += (1.0 - smoothstep(0.0, 0.5, tworley(uv*180.0, uPeriod*180.0).x))*0.05; // pinholes
    vec3 w = tworley(uv*26.0, uPeriod*26.0);
    h += (1.0-smoothstep(0.0,0.35,w.x))*0.12*step(0.55, w.z); // aggregate
    h -= cracks(uv, 7.0)*0.12;
    // form-board seam
    h -= smoothstep(0.985, 1.0, abs(sin(uv.y*PI*2.0)))*0.1;
    return h;
  }
  if(layer == 3){ // brick
    vec2 id, cu;
    float mortar = bricks(uv, 16.0, 8.0, id, cu, 0.5);
    float h = smoothstep(0.0, 0.35, mortar)*0.75;
    h += tfbm(uv*40.0, uPeriod*40.0, 3, 0.5)*0.12;
    h -= chips(uv, 22.0, 0.1)*0.25;
    return h;
  }
  if(layer == 6 || layer == 7){ // metal
    float h = tfbm(uv*20.0, uPeriod*20.0, 4, 0.5)*0.18;
    float dent = smoothstep(0.6,0.95, tfbm(uv*7.0, uPeriod*7.0, 3, 0.6));
    h -= dent*0.2;
    if(layer==7) h -= (1.0-smoothstep(0.0,0.5,tworley(uv*14.0, uPeriod*14.0).x))*0.16;
    return h;
  }
  if(layer == 8){ // wood
    vec2 wp = vec2(uv.x*4.0, uv.y);
    float plank = floor(wp.x);
    float grain = tfbm(vec2(uv.x*10.0 + plank*7.3, uv.y*90.0), uPeriod*90.0, 4, 0.55);
    float h = grain*0.35 + 0.4;
    float gap = min(fract(wp.x), 1.0-fract(wp.x));
    h -= (1.0-smoothstep(0.0,0.035,gap))*0.6;
    h -= chips(uv, 25.0, 0.08)*0.3;
    return h;
  }
  if(layer == 9){ // asphalt
    float h = tfbm(uv*30.0, uPeriod*30.0, 4, 0.55)*0.4;
    vec3 w = tworley(uv*44.0, uPeriod*44.0);
    h += (1.0-smoothstep(0.0,0.3,w.x))*0.22;
    h -= cracks(uv, 5.0)*0.3;
    float pothole = smoothstep(0.72, 0.95, tfbm(uv*2.5, uPeriod*2.5, 3, 0.6));
    h -= pothole*0.35;
    return h;
  }
  if(layer == 10){ // sand
    float h = tfbm(uv*8.0, uPeriod*8.0, 5, 0.6)*0.5;
    h += tfbm(uv*55.0, uPeriod*55.0, 3, 0.5)*0.25;
    float ripple = sin(uv.x*PI*36.0 + tfbm(uv*4.0,uPeriod*4.0,3,0.5)*9.0)*0.5+0.5;
    h += ripple*0.09;
    return h;
  }
  if(layer == 11 || layer == 17){ // woven fabric
    float warp = sin(uv.x*PI*220.0)*0.5+0.5;
    float weft = sin(uv.y*PI*220.0)*0.5+0.5;
    float h = max(warp,weft)*0.3 + tfbm(uv*9.0, uPeriod*9.0, 4, 0.6)*0.45;
    return h;
  }
  if(layer == 12){ // sandbag burlap
    float warp = sin(uv.x*PI*130.0)*0.5+0.5;
    float weft = sin(uv.y*PI*130.0)*0.5+0.5;
    float h = (warp*weft)*0.35 + tfbm(uv*13.0, uPeriod*13.0, 4, 0.6)*0.5;
    return h;
  }
  if(layer == 13){ // tile
    vec2 id, cu;
    float grout = bricks(uv, 10.0, 10.0, id, cu, 0.0);
    return smoothstep(0.0,0.25,grout)*0.7 + tfbm(uv*30.0,uPeriod*30.0,3,0.5)*0.08;
  }
  if(layer == 14 || layer == 16){ // gunmetal / polymer
    float h = tfbm(uv*46.0, uPeriod*46.0, 4, 0.5)*0.2;
    if(layer==16){
      // Stippled grip texture. Moulded polymer stipple is barely a tenth of a
      // millimetre proud — at any real amplitude a magazine held 30cm from the
      // eye turns into a lump of gravel.
      vec3 w = tworley(uv*115.0, uPeriod*115.0);
      h += (1.0-smoothstep(0.0,0.5,w.x))*0.14;
    } else {
      h += sin(uv.y*PI*160.0)*0.02;
    }
    return h;
  }
  if(layer == 15){ // gravel / rubble
    vec3 w = tworley(uv*20.0, uPeriod*20.0);
    float h = (1.0-smoothstep(0.0,0.45,w.x))*0.8;
    h += tfbm(uv*50.0,uPeriod*50.0,3,0.5)*0.2;
    return h;
  }
  if(layer == 19){ // corrugated sheet
    float ribs = sin(uv.x*PI*24.0)*0.5+0.5;
    float h = pow(ribs, 0.7)*0.85;
    h += tfbm(uv*35.0,uPeriod*35.0,3,0.5)*0.1;
    h -= (1.0-smoothstep(0.0,0.5,tworley(uv*17.0,uPeriod*17.0).x))*0.12;
    return h;
  }
  return tfbm(uv*20.0, uPeriod*20.0, 4, 0.5);
}

// ---------------------------------------------------------------- albedo
vec3 albedoFn(vec2 uv, int layer, float h){
  if(layer == 0){ // sun-faded beige plaster
    vec3 base = vec3(0.74,0.66,0.53);
    float macro = tfbm(uv*2.2, uPeriod*2.2, 4, 0.6);
    // Low-frequency variation is kept gentle. Rendered plaster is close to an
    // even colour with damage on top; heavy blotching reads as camouflage.
    base *= 0.88 + macro*0.22;
    base *= 0.92 + plasterGrain(uv)*0.17;
    base = mix(base, vec3(0.66,0.60,0.50), smoothstep(0.5,0.58, tfbm(uv*3.0,uPeriod*3.0,3,0.6))*0.7);
    base = mix(base, vec3(0.45,0.42,0.38), cracks(uv,9.0)*0.6);
    float rim; float chip = chips(uv,17.0,0.14,rim);
    base = mix(base, vec3(0.56,0.49,0.41), chip*0.65);
    base = mix(base, vec3(0.34,0.30,0.26), rim*0.55);
    base *= 1.0 - streaks(uv, 5.0, 0.6)*0.24;
    return base;
  }
  if(layer == 1){ // chalky off-white
    vec3 base = vec3(0.86,0.845,0.80);
    base *= 0.85 + tfbm(uv*2.6,uPeriod*2.6,4,0.6)*0.3;
    base *= 0.92 + plasterGrain(uv)*0.17;
    base = mix(base, vec3(0.68,0.66,0.62), smoothstep(0.5,0.6,tfbm(uv*4.0,uPeriod*4.0,3,0.6))*0.6);
    base = mix(base, vec3(0.5,0.48,0.45), cracks(uv,9.0)*0.55);
    float rim; float chip = chips(uv,17.0,0.13,rim);
    base = mix(base, vec3(0.60,0.57,0.52), chip*0.6);
    base = mix(base, vec3(0.36,0.34,0.31), rim*0.55);
    base *= 1.0 - streaks(uv, 6.0, 0.5)*0.3;
    return base;
  }
  if(layer == 18){ // pale peach
    vec3 base = vec3(0.80,0.66,0.56);
    base *= 0.85 + tfbm(uv*2.4,uPeriod*2.4,4,0.6)*0.3;
    base *= 0.92 + plasterGrain(uv)*0.17;
    float rim; float chip = chips(uv,15.0,0.16,rim);
    base = mix(base, vec3(0.60,0.52,0.45), chip*0.7);
    base = mix(base, vec3(0.33,0.28,0.25), rim*0.55);
    base = mix(base, vec3(0.42,0.38,0.35), cracks(uv,8.0)*0.55);
    base *= 1.0 - streaks(uv,5.0,0.55)*0.22;
    return base;
  }
  if(layer == 4){ // dusty blue
    vec3 base = vec3(0.53,0.60,0.63);
    base *= 0.88 + tfbm(uv*2.5,uPeriod*2.5,4,0.6)*0.22;
    base *= 0.92 + plasterGrain(uv)*0.17;
    float rim; float chip = chips(uv,16.0,0.16,rim);
    base = mix(base, vec3(0.63,0.58,0.50), chip*0.66); // render under the paint
    base = mix(base, vec3(0.28,0.30,0.31), rim*0.6);
    base = mix(base, vec3(0.36,0.4,0.42), cracks(uv,8.0)*0.55);
    base *= 1.0 - streaks(uv,5.5,0.55)*0.27;
    return base;
  }
  if(layer == 5){ // muted terracotta
    vec3 base = vec3(0.62,0.40,0.30);
    base *= 0.88 + tfbm(uv*2.5,uPeriod*2.5,4,0.6)*0.22;
    base *= 0.92 + plasterGrain(uv)*0.17;
    float rim; float chip = chips(uv,16.0,0.15,rim);
    base = mix(base, vec3(0.55,0.45,0.37), chip*0.6);
    base = mix(base, vec3(0.26,0.18,0.15), rim*0.6);
    base = mix(base, vec3(0.34,0.24,0.2), cracks(uv,8.0)*0.55);
    base *= 1.0 - streaks(uv,5.0,0.5)*0.28;
    return base;
  }
  if(layer == 2){ // concrete
    vec3 base = vec3(0.58,0.575,0.55);
    base *= 0.8 + tfbm(uv*2.0,uPeriod*2.0,4,0.6)*0.35;
    vec3 w = tworley(uv*26.0, uPeriod*26.0);
    base = mix(base, vec3(0.48,0.46,0.44), (1.0-smoothstep(0.0,0.35,w.x))*step(0.55,w.z)*0.6);
    base = mix(base, vec3(0.34,0.33,0.32), cracks(uv,7.0)*0.6);
    base *= 1.0 - streaks(uv,4.0,0.7)*0.3;
    base = mix(base, vec3(0.42,0.40,0.36), smoothstep(0.6,0.85,tfbm(uv*5.0,uPeriod*5.0,3,0.6))*0.35);
    return base;
  }
  if(layer == 3){ // brick
    vec2 id, cu;
    float mortar = bricks(uv, 16.0, 8.0, id, cu, 0.5);
    float v = hash12(id*1.37);
    vec3 brick = mix(vec3(0.50,0.28,0.21), vec3(0.66,0.44,0.32), v);
    brick *= 0.85 + tfbm(uv*30.0,uPeriod*30.0,3,0.5)*0.3;
    vec3 mortarCol = vec3(0.66,0.63,0.58)*(0.85+tfbm(uv*40.0,uPeriod*40.0,3,0.5)*0.3);
    vec3 base = mix(mortarCol, brick, smoothstep(0.0,0.3,mortar));
    base = mix(base, vec3(0.72,0.68,0.62), chips(uv,22.0,0.1)*0.5);
    base *= 1.0 - streaks(uv,5.0,0.6)*0.2;
    return base;
  }
  if(layer == 6){ // painted steel
    float v = tfbm(uv*3.0,uPeriod*3.0,3,0.6);
    vec3 base = mix(vec3(0.30,0.34,0.33), vec3(0.40,0.44,0.42), v);
    float wear = smoothstep(0.55,0.85,tfbm(uv*11.0,uPeriod*11.0,4,0.55));
    base = mix(base, vec3(0.42,0.30,0.20), wear*0.65);
    base = mix(base, vec3(0.55,0.56,0.58), (1.0-smoothstep(0.4,0.7,h))*0.2);
    return base;
  }
  if(layer == 7){ // rusted metal
    float r = tfbm(uv*6.0,uPeriod*6.0,5,0.55);
    vec3 base = mix(vec3(0.33,0.34,0.35), vec3(0.46,0.24,0.12), smoothstep(0.35,0.7,r));
    base = mix(base, vec3(0.30,0.14,0.07), smoothstep(0.6,0.9,r)*0.8);
    base *= 0.85 + tfbm(uv*30.0,uPeriod*30.0,3,0.5)*0.3;
    return base;
  }
  if(layer == 8){ // weathered wood
    vec2 wp = vec2(uv.x*4.0, uv.y);
    float plank = floor(wp.x);
    float tint = hash11(plank*3.7);
    float grain = tfbm(vec2(uv.x*10.0 + plank*7.3, uv.y*90.0), uPeriod*90.0, 4, 0.55);
    vec3 base = mix(vec3(0.42,0.31,0.20), vec3(0.60,0.47,0.32), tint);
    base *= 0.7 + grain*0.55;
    float gap = min(fract(wp.x), 1.0-fract(wp.x));
    base = mix(base, vec3(0.10,0.08,0.06), 1.0-smoothstep(0.0,0.03,gap));
    base = mix(base, vec3(0.66,0.60,0.50), chips(uv,25.0,0.08)*0.5); // bare splinters
    return base;
  }
  if(layer == 9){ // asphalt
    vec3 base = vec3(0.20,0.20,0.205);
    base *= 0.75 + tfbm(uv*4.0,uPeriod*4.0,4,0.6)*0.5;
    vec3 w = tworley(uv*44.0, uPeriod*44.0);
    base = mix(base, vec3(0.38,0.36,0.33), (1.0-smoothstep(0.0,0.3,w.x))*0.7);
    base = mix(base, vec3(0.11,0.11,0.115), cracks(uv,5.0)*0.8);
    // sand blown over the road
    float sand = smoothstep(0.45,0.75, tfbm(uv*3.2,uPeriod*3.2,4,0.6));
    base = mix(base, vec3(0.62,0.54,0.40), sand*0.55);
    // patched repair
    float patchMask = smoothstep(0.70,0.74, tfbm(uv*2.0,uPeriod*2.0,3,0.6));
    base = mix(base, vec3(0.14,0.14,0.15), patchMask*0.6);
    return base;
  }
  if(layer == 10){ // sand
    vec3 base = vec3(0.72,0.62,0.44);
    base *= 0.85 + tfbm(uv*3.0,uPeriod*3.0,4,0.6)*0.3;
    base = mix(base, vec3(0.58,0.50,0.37), smoothstep(0.5,0.8,tfbm(uv*7.0,uPeriod*7.0,4,0.6))*0.5);
    vec3 w = tworley(uv*40.0,uPeriod*40.0);
    base = mix(base, vec3(0.5,0.45,0.38), (1.0-smoothstep(0.0,0.2,w.x))*0.35); // pebbles
    return base;
  }
  if(layer == 11){ // awning fabric — striped, sun-bleached
    float stripe = step(0.5, fract(uv.x*6.0));
    float v = hash12(vec2(floor(uv.x*6.0), 3.0));
    vec3 a = mix(vec3(0.72,0.66,0.52), vec3(0.78,0.72,0.60), v);
    vec3 b = mix(vec3(0.42,0.30,0.24), vec3(0.30,0.42,0.40), step(0.5,v));
    vec3 base = mix(a, b, stripe);
    base *= 0.82 + tfbm(uv*8.0,uPeriod*8.0,4,0.6)*0.32;
    base *= 0.9 + h*0.2;
    base = mix(base, vec3(0.48,0.44,0.38), smoothstep(0.55,0.85,tfbm(uv*5.0,uPeriod*5.0,4,0.6))*0.4);
    return base;
  }
  if(layer == 17){ // gear cloth
    vec3 base = vec3(0.36,0.345,0.30);
    base *= 0.8 + tfbm(uv*10.0,uPeriod*10.0,4,0.6)*0.35;
    base *= 0.9 + h*0.25;
    return base;
  }
  if(layer == 12){ // sandbag burlap
    vec3 base = vec3(0.58,0.50,0.35);
    base *= 0.78 + tfbm(uv*6.0,uPeriod*6.0,4,0.6)*0.4;
    base *= 0.85 + h*0.3;
    base = mix(base, vec3(0.42,0.37,0.28), smoothstep(0.5,0.8,tfbm(uv*3.0,uPeriod*3.0,3,0.6))*0.5);
    return base;
  }
  if(layer == 13){ // interior tile
    vec2 id, cu;
    float grout = bricks(uv, 10.0, 10.0, id, cu, 0.0);
    float v = hash12(id*2.13);
    vec3 tile = mix(vec3(0.62,0.60,0.55), vec3(0.74,0.72,0.66), v);
    vec3 base = mix(vec3(0.40,0.38,0.35), tile, smoothstep(0.0,0.2,grout));
    base *= 0.9 + tfbm(uv*20.0,uPeriod*20.0,3,0.5)*0.2;
    return base;
  }
  if(layer == 14){ // anodized/parkerized gun metal
    // A hard-anodized finish is a thin dielectric over alloy, not a mirror: it
    // needs a real diffuse term or the gun renders as a black silhouette.
    vec3 base = vec3(0.455,0.462,0.472);
    base *= 0.86 + tfbm(uv*24.0,uPeriod*24.0,4,0.55)*0.28;
    float wear = smoothstep(0.72,0.95,tfbm(uv*9.0,uPeriod*9.0,4,0.55));
    base = mix(base, vec3(0.68,0.68,0.70), wear*0.8);        // rubbed to bare alloy
    return base;
  }
  if(layer == 16){ // polymer furniture
    vec3 base = vec3(0.245,0.250,0.242);
    base *= 0.88 + tfbm(uv*18.0,uPeriod*18.0,3,0.5)*0.22;
    base += vec3(0.030)*(1.0-smoothstep(0.0,0.5,tworley(uv*115.0,uPeriod*115.0).x));
    return base;
  }
  if(layer == 15){ // gravel
    vec3 w = tworley(uv*20.0, uPeriod*20.0);
    vec3 base = mix(vec3(0.34,0.32,0.29), vec3(0.62,0.57,0.48), hash11(w.z*13.0));
    base *= 0.7 + (1.0-smoothstep(0.0,0.45,w.x))*0.6;
    base = mix(base, vec3(0.55,0.48,0.36), 0.3);
    return base;
  }
  if(layer == 19){ // corrugated steel
    float ribs = sin(uv.x*PI*24.0)*0.5+0.5;
    vec3 base = mix(vec3(0.36,0.37,0.38), vec3(0.52,0.53,0.54), ribs);
    float rust = smoothstep(0.55,0.85, tfbm(uv*7.0,uPeriod*7.0,4,0.55));
    base = mix(base, vec3(0.42,0.22,0.11), rust*0.7);
    base *= 0.9 + tfbm(uv*35.0,uPeriod*35.0,3,0.5)*0.2;
    return base;
  }
  return vec3(0.5);
}

// ---------------------------------------------------------------- ORM
vec3 ormFn(vec2 uv, int layer, float h){
  float ao = clamp(0.55 + h*0.55, 0.0, 1.0);
  float rough = 0.8;
  float metal = 0.0;
  if(layer == 0 || layer == 1 || layer == 18){ rough = 0.82 + tfbm(uv*12.0,uPeriod*12.0,3,0.5)*0.14; }
  else if(layer == 4 || layer == 5){ rough = 0.66 + tfbm(uv*12.0,uPeriod*12.0,3,0.5)*0.22; }
  else if(layer == 2){ rough = 0.86 + tfbm(uv*14.0,uPeriod*14.0,3,0.5)*0.12; }
  else if(layer == 3){ rough = 0.88; }
  else if(layer == 6){ metal = 0.35; rough = 0.42 + tfbm(uv*13.0,uPeriod*13.0,3,0.5)*0.3; }
  else if(layer == 7){ float r = tfbm(uv*6.0,uPeriod*6.0,5,0.55); metal = mix(0.9,0.1,smoothstep(0.35,0.7,r)); rough = mix(0.42, 0.95, smoothstep(0.3,0.75,r)); }
  else if(layer == 8){ rough = 0.72 + tfbm(uv*20.0,uPeriod*20.0,3,0.5)*0.2; }
  else if(layer == 9){ rough = 0.78 + tfbm(uv*16.0,uPeriod*16.0,3,0.5)*0.18; }
  else if(layer == 10){ rough = 0.93; }
  else if(layer == 11 || layer == 17){ rough = 0.88; }
  else if(layer == 12){ rough = 0.94; }
  else if(layer == 13){ vec2 id,cu; float g=bricks(uv,10.0,10.0,id,cu,0.0); rough = mix(0.9, 0.3, smoothstep(0.0,0.2,g)); }
  else if(layer == 14){ float wear = smoothstep(0.72,0.95,tfbm(uv*9.0,uPeriod*9.0,4,0.55)); metal = mix(0.38, 0.85, wear); rough = mix(0.52 + tfbm(uv*24.0,uPeriod*24.0,4,0.55)*0.18, 0.26, wear); }
  else if(layer == 16){ metal = 0.0; rough = 0.62 + (1.0-smoothstep(0.0,0.5,tworley(uv*115.0,uPeriod*115.0).x))*0.22; }
  else if(layer == 15){ rough = 0.9; }
  else if(layer == 19){ float rust = smoothstep(0.55,0.85, tfbm(uv*7.0,uPeriod*7.0,4,0.55)); metal = mix(0.85,0.1,rust); rough = mix(0.38,0.92,rust); }
  return vec3(ao, clamp(rough,0.04,1.0), metal);
}

void main(){
  vec2 uv = vUv;
  float texel = 1.0/${'${TEX_SIZE}'}.0;

  // Height goes to a scratch buffer first and everything else reads it back.
  // Deriving the normal by re-evaluating heightFn at four neighbours inlines
  // the most expensive function in the file five times over, which costs both
  // shader size and five times the work per texel.
  if(uOutput == 3){
    outColor = vec4(heightFn(uv, uLayer), 0.0, 0.0, 1.0);
    return;
  }

  float h = texture(uHeight, uv).r;

  if(uOutput == 0){
    // Albedo swatches above are authored the way a colour picker reads them,
    // so they have to be linearised before the PBR pass ever sees them.
    vec3 srgb = clamp(albedoFn(uv, uLayer, h), 0.0, 1.0);
    vec3 lin = mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
    outColor = vec4(lin, 1.0);
  } else if(uOutput == 1){
    // Central differences: a forward difference biases the relief a half texel
    // toward the light and makes fine grain look like it is lit from one side.
    // The height buffer wraps, so the tile stays seamless across the edge.
    float hx0 = texture(uHeight, uv - vec2(texel,0.0)).r;
    float hx1 = texture(uHeight, uv + vec2(texel,0.0)).r;
    float hy0 = texture(uHeight, uv - vec2(0.0,texel)).r;
    float hy1 = texture(uHeight, uv + vec2(0.0,texel)).r;
    // Scaled by texel count so the relief keeps the same slope if the atlas
    // resolution changes; the 0.5 accounts for the two-texel central span.
    float strength = 6.0 * 0.5 * 0.0025 / texel;
    vec3 n = normalize(vec3((hx0-hx1)*strength, (hy0-hy1)*strength, 1.0));
    outColor = vec4(n*0.5+0.5, h);
  } else {
    outColor = vec4(ormFn(uv, uLayer, h), 1.0);
  }
}
`;

export class MaterialLibrary {
  /**
   * @param size  Edge of every layer in the material arrays. This is the hard
   *   ceiling on surface detail: at 512 a wall carries the same texel density
   *   whether it fills the screen or sits forty metres away, and no amount of
   *   render resolution recovers what the source never had. Memory is the
   *   reason it is not simply large — three arrays of `LAYER_COUNT` RGBA8
   *   layers is 63MB at 512 and 252MB at 1024, before mipmaps.
   * @param anisotropy  Requested max anisotropy, clamped to what the GPU has.
   */
  constructor(renderer, size = 512, anisotropy = 8) {
    this.anisotropy = anisotropy;
    this.renderer = renderer;
    this.size = size;
    this.albedo = null;
    this.normal = null;
    this.orm = null;
  }

  /**
   * Allocate the texture arrays and hand every layer program to the driver.
   *
   * One program is built per layer rather than one program branching over all
   * twenty. A single shader holding every material inlines this much noise into
   * a branch chain that AMD's D3D11 compiler spends minutes on and then runs at
   * a fraction of the throughput, because worst-case register pressure across
   * all the branches collapses occupancy. Twenty small programs compile and run
   * in a fraction of the time.
   *
   * Compilation is split from drawing so the caller can start it, go and build
   * the map on the CPU, and come back. The driver compiles on its own threads,
   * so that time is otherwise spent waiting on an idle main thread.
   */
  async compile() {
    const { renderer, size } = this;
    const opts = {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false
    };

    this._albedoRT = new THREE.WebGLArrayRenderTarget(size, size, LAYER_COUNT, opts);
    this._normalRT = new THREE.WebGLArrayRenderTarget(size, size, LAYER_COUNT, opts);
    this._ormRT = new THREE.WebGLArrayRenderTarget(size, size, LAYER_COUNT, opts);
    for (const rt of [this._albedoRT, this._normalRT, this._ormRT]) {
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.wrapT = THREE.RepeatWrapping;
      rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = true;
      // Anisotropy is what keeps a ground plane sharp at a grazing angle,
      // which is most of the frame in a first-person game. Capping it at 8
      // left the street mushy toward the horizon no matter how high the
      // render resolution went, because the limit was the filter, not the
      // sample count.
      rt.texture.anisotropy = Math.min(
        this.anisotropy, renderer.capabilities.getMaxAnisotropy()
      );
    }

    // Published as soon as they exist, not once they are painted. The material
    // factory is built while these are still blank so that map generation can
    // overlap the compile, and it captures whatever these are at that moment.
    this.albedo = this._albedoRT.texture;
    this.normal = this._normalRT.texture;
    this.orm = this._ormRT.texture;

    // Scratch height buffer, reused by every layer. Repeat wrapping keeps the
    // normal's neighbour taps seamless across the tile edge.
    this._heightRT = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false
    });

    const source = GEN_FRAG.replace('${TEX_SIZE}', String(size));

    this._passes = [];
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      this._passes.push(new FullscreenPass(source, {
        uOutput: { value: 3 },
        uPeriod: { value: 1.0 },
        uHeight: { value: null }
      }, { GEN_LAYER: layer }));
    }

    // Where KHR_parallel_shader_compile exists the twenty compiles overlap on
    // the driver's worker threads instead of stalling the GL thread one at a
    // time.
    const tCompile = performance.now();
    await Promise.all(this._passes.map((p) => renderer.compileAsync(p.scene, fullscreenCamera)));
    this.compileMs = Math.round(performance.now() - tCompile);
    return this;
  }

  /**
   * Draw every layer into the arrays. `onProgress` is awaited between layers,
   * which is also the only chance the browser gets to paint the loading bar.
   */
  async draw(onProgress) {
    const { renderer } = this;
    const targets = [this._albedoRT, this._normalRT, this._ormRT];
    const prevTarget = renderer.getRenderTarget();
    const tDraw = performance.now();

    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      const pass = this._passes[layer];
      pass.render(renderer, this._heightRT);
      pass.uniforms.uHeight.value = this._heightRT.texture;
      for (let o = 0; o < 3; o++) {
        pass.uniforms.uOutput.value = o;
        pass.render(renderer, targets[o], layer);
      }
      pass.dispose();
      if (onProgress) await onProgress((layer + 1) / LAYER_COUNT);
    }
    this._passes = null;
    this.drawMs = Math.round(performance.now() - tDraw);
    renderer.setRenderTarget(prevTarget);
    this._heightRT.dispose();
    this._heightRT = null;

    this._forceMipmaps(targets);
    return this;
  }

  /** three does not always mip array render targets; do it explicitly. */
  _forceMipmaps(targets) {
    const gl = this.renderer.getContext();
    for (const rt of targets) {
      const props = this.renderer.properties.get(rt.texture);
      const tex = props && props.__webglTexture;
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }
  }

  dispose() {
    this._albedoRT?.dispose();
    this._normalRT?.dispose();
    this._ormRT?.dispose();
  }
}
