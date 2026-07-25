// Shared GLSL noise / utility library. Injected into generated shaders.

export const GLSL_HASH = /* glsl */`
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float hash13(vec3 p3){ p3 = fract(p3*0.1031); p3 += dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
`;

export const GLSL_NOISE = /* glsl */`
${GLSL_HASH}

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}

float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float n000 = hash13(i), n100 = hash13(i+vec3(1,0,0));
  float n010 = hash13(i+vec3(0,1,0)), n110 = hash13(i+vec3(1,1,0));
  float n001 = hash13(i+vec3(0,0,1)), n101 = hash13(i+vec3(1,0,1));
  float n011 = hash13(i+vec3(0,1,1)), n111 = hash13(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
             mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}

// Tileable value noise over a period-P lattice.
float tnoise(vec2 p, float period){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 i0 = mod(i, period), i1 = mod(i+1.0, period);
  float a = hash12(i0);
  float b = hash12(vec2(i1.x, i0.y));
  float c = hash12(vec2(i0.x, i1.y));
  float d = hash12(i1);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

float tfbm(vec2 p, float period, int octaves, float gain){
  float s = 0.0, a = 0.5, per = period; float norm = 0.0;
  for(int i=0;i<8;i++){
    if(i>=octaves) break;
    s += a * tnoise(p, per);
    norm += a;
    a *= gain; p *= 2.0; per *= 2.0;
  }
  return s / max(norm, 1e-4);
}

float fbm(vec2 p, int octaves, float gain){
  float s=0.0, a=0.5, norm=0.0;
  for(int i=0;i<8;i++){
    if(i>=octaves) break;
    s += a*vnoise(p); norm += a; a*=gain; p = p*2.03 + 17.3;
  }
  return s/max(norm,1e-4);
}

float fbm3(vec3 p, int octaves, float gain){
  float s=0.0, a=0.5, norm=0.0;
  for(int i=0;i<8;i++){
    if(i>=octaves) break;
    s += a*vnoise3(p); norm += a; a*=gain; p = p*2.02 + 11.7;
  }
  return s/max(norm,1e-4);
}

// Tileable Worley (cellular) — returns (F1, F2, cellId)
vec3 tworley(vec2 p, float period){
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 cell = mod(n+g, period);
    vec2 o = hash22(cell);
    vec2 r = g + o - f;
    float d = dot(r,r);
    if(d < f1){ f2 = f1; f1 = d; id = hash12(cell); }
    else if(d < f2){ f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

float ridge(vec2 p, float period, int oct){
  float s=0.0, a=0.5, per=period, norm=0.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    float n = 1.0 - abs(tnoise(p, per)*2.0-1.0);
    s += a*n*n; norm += a; a*=0.5; p*=2.0; per*=2.0;
  }
  return s/max(norm,1e-4);
}

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const GLSL_PACK = /* glsl */`
vec2 octEncode(vec3 n){
  n /= (abs(n.x)+abs(n.y)+abs(n.z));
  vec2 e = n.xy;
  if(n.z < 0.0) e = (1.0 - abs(n.yx)) * vec2(n.x>=0.0?1.0:-1.0, n.y>=0.0?1.0:-1.0);
  return e*0.5+0.5;
}
vec3 octDecode(vec2 e){
  e = e*2.0-1.0;
  vec3 n = vec3(e.xy, 1.0-abs(e.x)-abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x>=0.0 ? -t : t;
  n.y += n.y>=0.0 ? -t : t;
  return normalize(n);
}
`;

export const GLSL_FULLSCREEN_VERT = /* glsl */`
out vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
