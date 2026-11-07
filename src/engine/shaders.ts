/** GLSL for every custom material. Three's ShaderMaterial prefix supplies matrices and cameraPosition. */

const PALETTE_GLSL = /* glsl */ `
  uniform vec3 uPalette[4];
  uniform float uHue;

  vec3 hueRotate(vec3 c, float a) {
    if (abs(a) < 0.001) return c;
    const vec3 k = vec3(0.57735);
    float cs = cos(a);
    return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
  }

  vec3 paletteAt(float t) {
    float x = fract(t) * 4.0;
    int i = int(floor(x));
    float f = smoothstep(0.0, 1.0, fract(x));
    return max(hueRotate(mix(uPalette[i], uPalette[(i + 1) % 4], f), uHue), vec3(0.0));
  }
`;

export const TUBE_VERT = /* glsl */ `
  precision highp sampler2D;
  uniform sampler2D uData;
  uniform float uK;
  uniform vec2 uMirror;
  uniform float uMirrorScale;
  uniform float uRadiusScale;
  uniform float uTime;
  ${PALETTE_GLSL}

  attribute vec3 aTube; // row, palette phase, base radius

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColorA;
  varying vec3 vColorB;
  varying float vLife;
  varying float vHeat;
  varying float vDepth;

  vec4 fetchPos(int i, int row) { return texelFetch(uData, ivec2(clamp(i, 0, int(uK) - 1), row * 2), 0); }
  vec4 fetchFrame(int i, int row) { return texelFetch(uData, ivec2(clamp(i, 0, int(uK) - 1), row * 2 + 1), 0); }

  void main() {
    int row = int(aTube.x + 0.5);
    float s = position.x * (uK - 1.0);
    float fi = min(floor(s), uK - 2.0);
    float f = s - fi;
    int i = int(fi);

    vec4 a = fetchPos(i - 1, row);
    vec4 b = fetchPos(i, row);
    vec4 c = fetchPos(i + 1, row);
    vec4 d = fetchPos(i + 2, row);

    // Catmull-Rom through the simulated control points.
    vec3 c1 = c.xyz - a.xyz;
    vec3 c2 = 2.0 * a.xyz - 5.0 * b.xyz + 4.0 * c.xyz - d.xyz;
    vec3 c3 = 3.0 * b.xyz - a.xyz - 3.0 * c.xyz + d.xyz;
    vec3 center = b.xyz + 0.5 * f * (c1 + f * (c2 + f * c3));
    vec3 tangent = c1 + f * (2.0 * c2 + 3.0 * f * c3);
    tangent = normalize(tangent + vec3(0.0, 0.0, 1e-5));

    vec4 fa = fetchFrame(i, row);
    vec4 fb = fetchFrame(i + 1, row);
    vec3 n = mix(fa.xyz, fb.xyz, f);
    n = normalize(n - tangent * dot(n, tangent) + vec3(1e-5, 0.0, 0.0));
    vec3 bn = cross(tangent, n);

    float radius = mix(b.w, c.w, f);
    float life = clamp(radius / max(aTube.z, 1e-4), 0.0, 1.0);
    // Bullet nose: rounds quickly, then eases out to full width.
    float cap = clamp(s / 7.0, 0.0, 1.0);
    radius *= sqrt(1.0 - (1.0 - cap) * (1.0 - cap)) * uMirrorScale * uRadiusScale;

    vec3 radial = n * position.y + bn * position.z;
    vec3 world = center + radial * radius;
    world.xy *= uMirror;
    radial.xy *= uMirror;

    vWorld = world;
    vNormal = radial;
    float along = aTube.y + position.x * 0.32 + uTime * 0.035;
    vColorA = paletteAt(along);
    vColorB = paletteAt(along + 0.22);
    vLife = life;
    vHeat = mix(fa.w, fb.w, f);
    vDepth = smoothstep(-3.2, 1.6, world.z);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

export const TUBE_FRAG = /* glsl */ `
  uniform vec3 uLightPos[4];
  uniform vec3 uLightColor[4];
  uniform float uGain;
  uniform float uIntro;

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColorA;
  varying vec3 vColorB;
  varying float vLife;
  varying float vHeat;
  varying float vDepth;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(N, V), 0.0, 1.0);

    // Glassy body: a dim shell lit by moving coloured lights, with a filament inside.
    vec3 lit = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec3 L = uLightPos[i] - vWorld;
      float d2 = dot(L, L);
      L /= sqrt(d2);
      float att = 1.0 / (1.0 + 0.16 * d2);
      float wrap = clamp(dot(N, L) * 0.6 + 0.4, 0.0, 1.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 72.0);
      lit += uLightColor[i] * att * (wrap * wrap * vColorA * 0.5 + spec * 0.9);
    }

    float fresnel = pow(1.0 - ndv, 2.6);
    float filament = pow(ndv, 3.2);
    vec3 body = vColorA * (0.14 + filament * 1.25);
    vec3 rim = vColorB * fresnel * 1.35;
    vec3 hot = mix(vColorA, vec3(1.0), 0.3) * pow(ndv, 12.0) * (0.3 + vHeat * 2.4);

    // Tails dissolve into the dark before they get thin enough to look like hairs.
    float fade = smoothstep(0.05, 0.7, vLife);
    vec3 color = (lit + body + rim + hot) * fade;
    color *= mix(0.42, 1.0, vDepth) * uGain * uIntro;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const BACKDROP_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

export const BACKDROP_FRAG = /* glsl */ `
  uniform vec3 uBg;
  uniform vec3 uGlowA;
  uniform vec3 uGlowB;
  uniform vec2 uPosA;
  uniform vec2 uPosB;
  uniform float uAspect;
  varying vec2 vP;
  void main() {
    vec2 asp = vec2(uAspect, 1.0);
    float a = dot((vP - uPosA) * asp, (vP - uPosA) * asp);
    float b = dot((vP - uPosB) * asp, (vP - uPosB) * asp);
    vec3 c = uBg + uGlowA * exp(-a * 1.6) * 0.0035 + uGlowB * exp(-b * 1.2) * 0.0025;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export const DUST_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  ${PALETTE_GLSL}
  attribute vec4 aSeed;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.05 * aSeed.x + aSeed.y * 6.28) * 0.5;
    p.y += cos(uTime * 0.04 * aSeed.y + aSeed.z * 6.28) * 0.5;
    p.z += sin(uTime * 0.03 + aSeed.x * 6.28) * 0.4;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float twinkle = 0.45 + 0.55 * sin(uTime * (0.4 + aSeed.z) + aSeed.w * 6.28);
    vColor = paletteAt(aSeed.w) * (0.1 + 0.28 * twinkle * twinkle);
    gl_PointSize = uScale * (0.6 + aSeed.x * 1.3) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const DUST_FRAG = /* glsl */ `
  uniform float uIntro;
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = exp(-dot(q, q) * 3.5);
    gl_FragColor = vec4(vColor * d * uIntro, 1.0);
  }
`;

export const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uMirror;
  uniform float uMirrorScale;
  uniform float uGain;
  attribute vec4 aA; // origin, birth
  attribute vec4 aB; // velocity, life
  attribute vec4 aC; // colour, size
  varying vec2 vQ;
  varying vec3 vColor;
  const float DRAG = 2.3;
  void main() {
    float age = uTime - aA.w;
    if (age < 0.0 || age >= aB.w || aB.w <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float e = exp(-DRAG * age);
    vec3 p = aA.xyz + aB.xyz * (1.0 - e) / DRAG;
    p.y -= 0.16 * age * age;
    vec3 v = aB.xyz * e;
    p.xy *= uMirror;
    v.xy *= uMirror;

    float life = age / aB.w;
    float fade = (1.0 - life) * (1.0 - life);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vec3 vv = (viewMatrix * vec4(v, 0.0)).xyz;
    float speed = length(vv.xy);
    vec2 dir = speed > 0.001 ? vv.xy / speed : vec2(1.0, 0.0);
    float size = aC.w * (0.4 + 0.6 * (1.0 - life)) * uMirrorScale;
    float stretch = 1.0 + speed * 0.55;
    mv.xy += dir * position.x * size * stretch + vec2(-dir.y, dir.x) * position.y * size;
    vQ = position.xy;
    vColor = aC.rgb * fade * (1.0 + 3.5 * e) * uGain;
    gl_Position = projectionMatrix * mv;
  }
`;

export const PARTICLE_FRAG = /* glsl */ `
  varying vec2 vQ;
  varying vec3 vColor;
  void main() {
    float d = dot(vQ, vQ);
    if (d > 1.0) discard;
    float a = exp(-d * 4.5) * (1.0 - d);
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

export const DISK_VERT = /* glsl */ `
  attribute vec4 aCenter; // world position, outer radius
  attribute vec4 aTilt;   // tilt x, roll z, seed, spin direction
  varying vec2 vQ;
  varying vec2 vSeed;
  void main() {
    vec3 q = vec3(position.xy, 0.0);
    float cr = cos(aTilt.y), sr = sin(aTilt.y);
    float ct = cos(aTilt.x), st = sin(aTilt.x);
    vec3 r = vec3(q.x, q.y * ct, q.y * st);
    r = vec3(r.x * cr - r.y * sr, r.x * sr + r.y * cr, r.z);
    vQ = position.xy;
    vSeed = aTilt.zw;
    gl_Position = projectionMatrix * viewMatrix * vec4(aCenter.xyz + r * aCenter.w, 1.0);
  }
`;

export const DISK_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGain;
  ${PALETTE_GLSL}
  varying vec2 vQ;
  varying vec2 vSeed;
  void main() {
    float r = length(vQ);
    if (r >= 1.0) discard;
    float ang = atan(vQ.y, vQ.x);
    float spin = uTime * vSeed.y * 1.6 / (r * r + 0.18);
    float lr = log(r + 0.02);
    float a1 = sin(ang * 3.0 + lr * 6.0 - spin + vSeed.x * 40.0);
    float a2 = sin(ang * 7.0 + lr * 11.0 - spin * 1.4 + vSeed.x * 90.0);
    float a3 = sin(ang * 13.0 - lr * 5.0 - spin * 0.8);
    float streak = 0.58 + 0.26 * a1 + 0.15 * a2 + 0.08 * a3;
    float inner = 0.3;
    float mask = smoothstep(inner, inner + 0.05, r) * pow(smoothstep(1.0, inner + 0.08, r), 1.8);
    float doppler = 1.0 + 0.6 * cos(ang + vSeed.x * 6.28);
    float heat = pow(inner / max(r, inner), 1.6);
    vec3 col = mix(paletteAt(vSeed.x + r * 0.35), vec3(1.0, 0.95, 0.9), heat * heat * 0.75);
    gl_FragColor = vec4(col * streak * streak * mask * doppler * (0.45 + heat * 3.4) * uGain, 1.0);
  }
`;

/** Runs as a postprocessing Effect, before bloom, so warped light blooms correctly. */
export const LENS_FRAG = /* glsl */ `
  uniform vec4 uHoles[24];
  uniform int uHoleCount;
  uniform vec4 uShocks[4];
  uniform float uAberration;
  uniform float uViewAspect;
  uniform vec3 uRingColor;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 asp = vec2(uViewAspect, 1.0);
    vec2 offset = vec2(0.0);
    float shadow = 1.0;
    vec3 emit = vec3(0.0);

    for (int i = 0; i < uHoleCount; i++) {
      vec4 h = uHoles[i];
      float rs = h.z;
      if (rs < 1e-4) continue;
      vec2 d = (uv - h.xy) * asp;
      float r = max(length(d), 1e-4);
      vec2 dir = d / r;
      // Frame dragging twists the light close to the horizon.
      float tw = 1.5 * rs * rs / (r * r + rs * rs * 0.5);
      float cs = cos(tw), sn = sin(tw);
      vec2 twisted = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
      offset += twisted - d;
      // Thin-lens deflection toward the mass.
      offset -= dir * rs * rs * 1.55 / max(r, rs * 0.6);
      shadow *= smoothstep(rs * 0.97, rs * 1.05, r);
      float ring = (r - rs * 1.13) / (rs * 0.05);
      float halo = (r - rs * 1.13) / (rs * 0.55);
      emit += uRingColor * h.w * (exp(-ring * ring) * 2.6 + exp(-halo * halo) * 0.16);
    }

    for (int i = 0; i < 4; i++) {
      vec4 s = uShocks[i];
      if (s.w <= 0.0) continue;
      vec2 d = (uv - s.xy) * asp;
      float r = max(length(d), 1e-4);
      float w = (r - s.z) / (0.035 + s.z * 0.18);
      offset += (d / r) * s.w * exp(-w * w) * w;
    }

    vec2 base = uv + offset / asp;
    vec2 ca = (uv - 0.5) * uAberration * dot(uv - 0.5, uv - 0.5) + offset / asp * 0.04;
    vec3 c = vec3(
      texture2D(inputBuffer, base + ca).r,
      texture2D(inputBuffer, base).g,
      texture2D(inputBuffer, base - ca).b
    );
    outputColor = vec4(c * shadow + emit * shadow, 1.0);
  }
`;
