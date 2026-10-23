import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { fa } from "../../fmt";
import { ART, COLOURS } from "../mascot";

/* A 3D model of one mall, built from Torob's own data: its floors, and on each floor every shop in the order of its
   unit number around an atrium. The shape of the building is a stand-in (there is no architectural plan); which
   floor a shop is on, and its place in the order, are real. The pixel radish walks the way in: from the street,
   through the door, up the glass lift, along the corridor to the shop, which glows light red. */

export type Mall3DShop = { sid: number; unit: string | null; name: string; kind: "target" | "offer" | "other"; price: number | null };
export type Mall3DData = {
  mall_name: string;
  target_floor: number;
  unit: string | null;
  offers: number;
  shop: string;
  floors: { num: number; count: number; shops: Mall3DShop[] }[];
  arrive: { near: boolean; title: string; text: string } | null;
};
export type MallScene = { replay(): void; manual(on: boolean): void; step(dt: number): Promise<void>; dispose(): void; times: { arrive: number; end: number } };

// the building, in metres-ish units: x across the front, z towards the street, y up
const HX = 22, HZ = 14, FH = 4.2, SLAB = 0.35, SD = 5;
const VX = 10, VZ = 3.5; // the atrium, open through every floor
const FX = 17, FZ = 9; // the line of shop fronts
const CX = 13.5, CZ = 6.25; // the corridor's middle, between the shop fronts and the atrium
const GAP = 4.2; // the front stays open around the middle: the door below, the lift landing above
const EX = 7.2, EZ = 5.2; // the glass lift, at the atrium's front corner
const WALK = 5.2; // the radish's walking speed, units a second
const RED = 0xe91e33, GREEN = 0x16a34a;

const yOf = (f: number) => f * FH;
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** A text label as a sprite (Persian is shaped by the browser's canvas), always facing the camera. */
function label(text: string, o: { bg: string; fg: string; size?: number; onTop?: boolean; screen?: number }): THREE.Sprite {
  const px = 44;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = `800 ${px}px IRANYekanX, Tahoma, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + px * 1.1;
  const h = Math.ceil(px * 1.75);
  c.width = w;
  c.height = h;
  g.font = font;
  g.fillStyle = o.bg;
  const r = h / 2;
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(w - r, 0); g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, h); g.arc(r, r, r, Math.PI / 2, Math.PI * 1.5);
  g.fill();
  g.fillStyle = o.fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.direction = "rtl";
  g.fillText(text, w / 2, h / 2 + px * 0.06);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // `screen`: the same size on screen however near (a share of the view's height), for the shop's own name
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: !o.onTop, transparent: true, sizeAttenuation: !o.screen });
  const s = new THREE.Sprite(m);
  const k = o.screen ?? (o.size ?? 1) * 1.1;
  s.scale.set((w / h) * k, k, 1);
  if (o.onTop) s.renderOrder = 999;
  return s;
}

/** The pixel radish as voxels: the body three blocks deep, the leaves one. */
function radish(): THREE.Group {
  const v = 0.13;
  const cells: { x: number; y: number; z: number; c: string }[] = [];
  ART.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = COLOURS[ch];
      if (!col) return;
      const leaf = ch === "L" || ch === "l";
      for (const z of leaf ? [0] : [-1, 0, 1]) {
        // the face (eyes, cheeks, mouth) only on the front layer; behind it the plain body colour
        const c = z === 1 || leaf || ch === "O" || ch === "R" || ch === "H" ? col : COLOURS.R;
        cells.push({ x, y, z, c });
      }
    });
  });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(v, v, v), new THREE.MeshLambertMaterial(), cells.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  cells.forEach((cell, i) => {
    m.makeTranslation((cell.x - 6.5) * v, (ART.length - 1 - cell.y) * v + v / 2, cell.z * v);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.set(cell.c));
  });
  const body = new THREE.Group();
  body.add(mesh);
  const g = new THREE.Group();
  g.add(body);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.name = "shadow";
  g.add(shadow);
  body.name = "body";
  return g;
}

/** Where the shop with order `i` of `n` stands on the line of fronts: the point on the line, and which way is out. */
const FRONT: [number, number][] = [[GAP, FZ], [FX, FZ], [FX, -FZ], [-FX, -FZ], [-FX, FZ], [-GAP, FZ]];
function along(u: number): { p: THREE.Vector2; n: THREE.Vector2; seg: number } {
  for (let i = 0; i < FRONT.length - 1; i++) {
    const a = new THREE.Vector2(...FRONT[i]), b = new THREE.Vector2(...FRONT[i + 1]);
    const len = a.distanceTo(b);
    if (u <= len || i === FRONT.length - 2) {
      const d = b.clone().sub(a).normalize();
      return { p: a.clone().addScaledVector(d, Math.min(u, len)), n: new THREE.Vector2(-d.y, d.x), seg: i };
    }
    u -= len;
  }
  return { p: new THREE.Vector2(), n: new THREE.Vector2(0, 1), seg: 0 };
}
const FRONT_LEN = FRONT.slice(1).reduce((s, q, i) => s + new THREE.Vector2(...q).distanceTo(new THREE.Vector2(...FRONT[i])), 0);

// the corridor as a loop, to walk from the lift to any shop the short way round
const RING: THREE.Vector2[] = [new THREE.Vector2(CX, CZ), new THREE.Vector2(CX, -CZ), new THREE.Vector2(-CX, -CZ), new THREE.Vector2(-CX, CZ)];
const RING_LEN = 2 * (2 * CX + 2 * CZ);
function ringU(p: THREE.Vector2): number {
  let best = 0, bd = Infinity, acc = 0;
  for (let i = 0; i < 4; i++) {
    const a = RING[i], b = RING[(i + 1) % 4];
    const ab = b.clone().sub(a), t = clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
    const q = a.clone().addScaledVector(ab, t);
    const d = q.distanceTo(p);
    if (d < bd) { bd = d; best = acc + t * ab.length(); }
    acc += ab.length();
  }
  return best;
}
function ringAt(u: number): THREE.Vector2 {
  u = ((u % RING_LEN) + RING_LEN) % RING_LEN;
  for (let i = 0; i < 4; i++) {
    const a = RING[i], b = RING[(i + 1) % 4], len = a.distanceTo(b);
    if (u <= len) return a.clone().lerp(b, u / len);
    u -= len;
  }
  return RING[0].clone();
}
function ringPath(from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2[] {
  const u1 = ringU(from), u2 = ringU(to);
  let d = u2 - u1;
  if (d > RING_LEN / 2) d -= RING_LEN;
  if (d < -RING_LEN / 2) d += RING_LEN;
  const pts = [ringAt(u1)];
  const corners = [0, 2 * CZ, 2 * CZ + 2 * CX, 4 * CZ + 2 * CX].flatMap((c) => [c, c + RING_LEN, c - RING_LEN]);
  const between = corners.filter((c) => (d > 0 ? c > u1 && c < u1 + d : c < u1 && c > u1 + d)).sort((a, b) => (d > 0 ? a - b : b - a));
  for (const c of between) pts.push(ringAt(c));
  pts.push(ringAt(u1 + d));
  return pts;
}

type Leg = { t0: number; t1: number; a: THREE.Vector3; b: THREE.Vector3; kind: "hop" | "walk" | "ride" | "party" };

export function createMallScene(host: HTMLElement, data: Mall3DData, hooks: { onArrive: () => void }): MallScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xeaf2fb, 90, 240);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 12;
  controls.maxDistance = 140;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc7d2e0, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(40, 80, 55);
  scene.add(sun);

  const nums = data.floors.map((f) => f.num);
  const top = Math.max(...nums), bottom = Math.min(...nums);
  const target = data.target_floor;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const above: { m: THREE.Material & { opacity: number }; base: number }[] = []; // fade when the radish reaches its floor

  // the street, the pavement and a few trees, with the building's footprint cut out of the ground
  const ground = new THREE.Shape();
  ground.moveTo(-200, -200); ground.lineTo(200, -200); ground.lineTo(200, 200); ground.lineTo(-200, 200); ground.lineTo(-200, -200);
  const hole = new THREE.Path();
  hole.moveTo(-HX, -HZ); hole.lineTo(-HX, HZ); hole.lineTo(HX, HZ); hole.lineTo(HX, -HZ); hole.lineTo(-HX, -HZ);
  ground.holes.push(hole);
  const gmesh = new THREE.Mesh(keep(new THREE.ShapeGeometry(ground)), keep(new THREE.MeshLambertMaterial({ color: 0xe6ebf1, transparent: target < 0, opacity: target < 0 ? 0.55 : 1, depthWrite: target >= 0 })));
  gmesh.rotation.x = -Math.PI / 2;
  gmesh.position.y = -0.02;
  scene.add(gmesh);
  const road = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 11)), keep(new THREE.MeshLambertMaterial({ color: 0x64748b })));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.0, HZ + 13);
  scene.add(road);
  const dashMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (let x = -120; x <= 120; x += 6) {
    const d = new THREE.Mesh(keep(new THREE.PlaneGeometry(3, 0.25)), dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.01, HZ + 13);
    scene.add(d);
  }
  const trunk = keep(new THREE.CylinderGeometry(0.18, 0.24, 1.6, 8)), crown = keep(new THREE.SphereGeometry(1.25, 14, 10));
  const trunkM = keep(new THREE.MeshLambertMaterial({ color: 0x8b6b4a })), crownM = keep(new THREE.MeshLambertMaterial({ color: 0x6fbc23 }));
  for (const x of [-34, -27, -12, 12, 27, 34]) {
    const t = new THREE.Mesh(trunk, trunkM); t.position.set(x, 0.8, HZ + 6.5); scene.add(t);
    const c = new THREE.Mesh(crown, crownM); c.position.set(x, 2.3, HZ + 6.5); scene.add(c);
  }

  // floors: a slab round the atrium, a glass rail at its edge, and the shops along the fronts
  const slabMat = (f: number) => keep(new THREE.MeshLambertMaterial({ color: f === target ? 0xfff0f2 : 0xf1f5f9, transparent: true, opacity: f === target ? 0.85 : 0.5, depthWrite: f === target }));
  const glassMat = () => keep(new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.22, depthWrite: false }));
  const lineMat = (c: number, o: number) => keep(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o }));
  const shopFill = {
    other: () => keep(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false })),
    offer: () => keep(new THREE.MeshLambertMaterial({ color: 0x4ade80, emissive: 0x166534, emissiveIntensity: 0.25, transparent: true, opacity: 0.4, depthWrite: false })),
    target: () => keep(new THREE.MeshLambertMaterial({ color: 0xff6b78, emissive: 0xe91e33, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, depthWrite: false })),
  };
  let targetShop: { center: THREE.Vector3; front: THREE.Vector2; normal: THREE.Vector2; fill: THREE.MeshLambertMaterial } | null = null;

  for (const fl of data.floors) {
    const y = yOf(fl.num);
    const mats: (THREE.Material & { opacity: number })[] = [];
    const sm = slabMat(fl.num);
    mats.push(sm);
    for (const [w, d, x, z] of [[2 * HX, HZ - VZ, 0, (HZ + VZ) / 2], [2 * HX, HZ - VZ, 0, -(HZ + VZ) / 2], [HX - VX, 2 * VZ, -(HX + VX) / 2, 0], [HX - VX, 2 * VZ, (HX + VX) / 2, 0]]) {
      const slab = new THREE.Mesh(keep(new THREE.BoxGeometry(w, SLAB, d)), sm);
      slab.position.set(x, y, z);
      scene.add(slab);
    }
    const outline = new THREE.LineSegments(keep(new THREE.EdgesGeometry(keep(new THREE.BoxGeometry(2 * HX, SLAB, 2 * HZ)))), lineMat(fl.num === target ? RED : 0x94a3b8, fl.num === target ? 0.9 : 0.45));
    outline.position.y = y;
    scene.add(outline);
    mats.push(outline.material as THREE.LineBasicMaterial);
    const rail = glassMat();
    mats.push(rail);
    for (const [w, d, x, z] of [[2 * VX, 0.08, 0, VZ], [2 * VX, 0.08, 0, -VZ], [0.08, 2 * VZ, VX, 0], [0.08, 2 * VZ, -VX, 0]]) {
      const r = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 1.05, d)), rail);
      r.position.set(x, y + SLAB / 2 + 0.52, z);
      scene.add(r);
    }
    // the shops of this floor in unit order, evenly along the fronts
    const n = fl.shops.length;
    const pitch = n ? FRONT_LEN / n : FRONT_LEN;
    const h = FH - SLAB - 0.7;
    fl.shops.forEach((s, i) => {
      const { p, n: nor } = along((i + 0.5) * pitch);
      const wid = clamp(pitch * 0.9, 1.6, 6.5);
      const geo = keep(new THREE.BoxGeometry(wid, h, SD - 0.3));
      const fill = shopFill[s.kind]();
      const box = new THREE.Mesh(geo, fill);
      const cx = p.x + nor.x * (SD / 2), cz = p.y + nor.y * (SD / 2);
      box.position.set(cx, y + SLAB / 2 + h / 2, cz);
      box.rotation.y = Math.atan2(nor.x, nor.y);
      scene.add(box);
      const edges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo)), lineMat(s.kind === "target" ? RED : s.kind === "offer" ? GREEN : 0x9aa7b8, s.kind === "other" ? 0.5 : 0.95));
      edges.position.copy(box.position);
      edges.rotation.copy(box.rotation);
      scene.add(edges);
      if (s.kind !== "target") mats.push(fill, edges.material as THREE.LineBasicMaterial);
      if (s.kind === "target") targetShop = { center: box.position.clone(), front: p.clone(), normal: nor.clone(), fill: fill as THREE.MeshLambertMaterial };
    });
    const tag = label(fl.num === 0 ? "همکف" : fl.num < 0 ? `منفی ${fa(-fl.num)}` : `طبقهٔ ${fa(fl.num)}`,
      fl.num === target ? { bg: "#e91e33", fg: "#ffffff", size: 1.3 } : { bg: "rgba(255,255,255,0.92)", fg: "#475569", size: 1.1 });
    tag.position.set(-HX - 3.2, y + 1.4, HZ - 1);
    scene.add(tag);
    if (fl.num > target) for (const m of mats) above.push({ m, base: m.opacity });
    if (fl.num > target) above.push({ m: tag.material as THREE.SpriteMaterial, base: 1 });
  }

  // the glass skin, the roof, the sign over the door, and an escalator between each pair of floors
  const height = yOf(top) + FH - yOf(bottom);
  const skin = new THREE.Mesh(keep(new THREE.BoxGeometry(2 * HX, height, 2 * HZ)), keep(new THREE.MeshLambertMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })));
  skin.position.y = yOf(bottom) + height / 2 - SLAB / 2;
  scene.add(skin);
  const skinEdges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(skin.geometry)), lineMat(0x64748b, 0.4));
  skinEdges.position.copy(skin.position);
  scene.add(skinEdges);
  above.push({ m: skin.material as THREE.MeshLambertMaterial, base: 0.07 });
  const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(2 * HX + 0.6, 0.5, 2 * HZ + 0.6)), keep(new THREE.MeshLambertMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.6, depthWrite: false })));
  roof.position.y = yOf(top) + FH;
  scene.add(roof);
  above.push({ m: roof.material as THREE.MeshLambertMaterial, base: 0.6 });
  const sign = label(data.mall_name.replace("علاالدین", "علاءالدین"), { bg: "#e91e33", fg: "#ffffff", size: 2.2 });
  sign.position.set(0, FH + 2.6, HZ + 0.6);
  scene.add(sign);
  above.push({ m: sign.material as THREE.SpriteMaterial, base: 1 });
  const canopy = new THREE.Mesh(keep(new THREE.BoxGeometry(2 * GAP + 1, 0.25, 3)), keep(new THREE.MeshLambertMaterial({ color: 0xe91e33 })));
  canopy.position.set(0, FH - 0.9, HZ + 1.4);
  scene.add(canopy);
  const escM = keep(new THREE.MeshLambertMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.75 }));
  for (let f = bottom; f < top; f++) {
    const dir = f % 2 === 0 ? 1 : -1;
    const run = 9, rise = FH;
    const esc = new THREE.Mesh(keep(new THREE.BoxGeometry(Math.hypot(run, rise), 0.3, 1.4)), escM);
    esc.position.set(-2 + dir * 0, yOf(f) + rise / 2, -1.2 + (f % 2) * 2.4);
    esc.rotation.z = dir * Math.atan2(rise, run);
    scene.add(esc);
  }

  // the glass lift
  const shaft = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, height, 2.4)), keep(new THREE.MeshLambertMaterial({ color: 0xa5d8ff, transparent: true, opacity: 0.16, depthWrite: false })));
  shaft.position.set(EX, skin.position.y, EZ);
  scene.add(shaft);
  const shaftEdges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(shaft.geometry)), lineMat(0x3b82f6, 0.55));
  shaftEdges.position.copy(shaft.position);
  scene.add(shaftEdges);
  const cabin = new THREE.Group();
  const cabinBox = new THREE.Mesh(keep(new THREE.BoxGeometry(2.1, 2.9, 2.1)), keep(new THREE.MeshLambertMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.35, depthWrite: false })));
  cabinBox.position.y = 1.45;
  cabin.add(cabinBox);
  const cabinEdges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(cabinBox.geometry)), lineMat(0x2563eb, 0.9));
  cabinEdges.position.y = 1.45;
  cabin.add(cabinEdges);
  cabin.position.set(EX, SLAB / 2, EZ);
  scene.add(cabin);

  // the shop: a beam of light above it and its name
  const ts = targetShop as { center: THREE.Vector3; front: THREE.Vector2; normal: THREE.Vector2; fill: THREE.MeshLambertMaterial } | null;
  const tY = yOf(target) + SLAB / 2;
  let beam: THREE.Mesh | null = null, shopTag: THREE.Sprite | null = null;
  const glow = new THREE.PointLight(0xff3b4e, 0, 16, 1.6);
  if (ts) {
    const bh = yOf(top) + FH + 18 - tY;
    beam = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.7, 0.7, bh, 20, 1, true)), keep(new THREE.MeshBasicMaterial({ color: 0xff5a6a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })));
    beam.position.set(ts.center.x, tY + bh / 2, ts.center.z);
    scene.add(beam);
    shopTag = label(`واحد ${data.unit ?? "؟"} · ${data.shop}`, { bg: "#e91e33", fg: "#ffffff", onTop: true, screen: 0.05 });
    shopTag.position.set(ts.center.x, tY + FH + 0.6, ts.center.z);
    (shopTag.material as THREE.SpriteMaterial).opacity = 0;
    scene.add(shopTag);
    glow.position.set(ts.center.x, tY + 2, ts.center.z);
    scene.add(glow);
  }

  // the way: street, door, lift, up (or down), out, along the corridor to the shop front
  const bot = radish();
  scene.add(bot);
  const legs: Leg[] = [];
  let t = 0;
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const add = (kind: Leg["kind"], a: THREE.Vector3, b: THREE.Vector3, dur?: number) => {
    const d = dur ?? Math.max(0.2, a.distanceTo(b) / WALK);
    legs.push({ t0: t, t1: t + d, a, b, kind });
    t += d;
  };
  const street = v3(0, SLAB / 2, HZ + 5.5);
  add("hop", street, street, 3.0);
  const walkPts = [street, v3(0, SLAB / 2, HZ + 0.5), v3(0, SLAB / 2, CZ + 0.4), v3(EX, SLAB / 2, CZ + 0.6), v3(EX, SLAB / 2, EZ)];
  for (let i = 1; i < walkPts.length; i++) add("walk", walkPts[i - 1], walkPts[i]);
  const rideFrom = v3(EX, SLAB / 2, EZ), rideTo = v3(EX, tY, EZ);
  add("ride", rideFrom, rideTo, 1.4 + Math.abs(target) * 0.42);
  const rideEnd = t;
  const exitPt = v3(EX, tY, CZ);
  add("walk", rideTo, exitPt);
  const front = ts ? new THREE.Vector2(clamp(ts.front.x, -CX, CX), clamp(ts.front.y, -CZ, CZ)) : new THREE.Vector2(0, CZ);
  if (ts && Math.abs(ts.normal.x) > 0.5) front.set(Math.sign(ts.normal.x) * CX, clamp(ts.front.y, -CZ, CZ));
  if (ts && Math.abs(ts.normal.y) > 0.5) front.set(clamp(ts.front.x, -CX, CX), Math.sign(ts.normal.y) * CZ);
  const corridor = ringPath(new THREE.Vector2(exitPt.x, exitPt.z), front);
  let prev = exitPt;
  for (const q of corridor) {
    const p = v3(q.x, tY, q.y);
    if (p.distanceTo(prev) > 0.05) add("walk", prev, p);
    prev = p;
  }
  const door = ts ? v3(ts.front.x - ts.normal.x * 0.8, tY, ts.front.y - ts.normal.y * 0.8) : prev;
  add("walk", prev, door);
  const arriveAt = t;
  add("party", door, door, 2.4);
  const dots: THREE.Vector3[] = [];
  for (const l of legs) {
    if (l.kind !== "walk" && l.kind !== "ride") continue;
    const n = Math.max(1, Math.round(l.a.distanceTo(l.b) / 0.9));
    for (let i = 0; i < n; i++) dots.push(l.a.clone().lerp(l.b, i / n).add(new THREE.Vector3(0, 0.06, 0)));
  }
  const dot = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12)), keep(new THREE.MeshBasicMaterial({ color: RED })), dots.length);
  const dm = new THREE.Matrix4();
  dots.forEach((q, i) => dot.setMatrixAt(i, dm.makeTranslation(q.x, q.y, q.z)));
  scene.add(dot);
  const outroAt = t;
  const END = t + 7;

  // the camera: a wide shot, then close behind the radish, beside the lift, over its shoulder, at the shop, wide again
  const camPos = v3(70, 52, 96), camLook = v3(0, 10, 0);
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let facing = Math.PI; // towards the building
  let arrived = false, time = 0, manualMode = false, raf = 0, lastNow = performance.now(), done = false;
  const legAt = (tt: number) => legs.find((l) => tt < l.t1) ?? legs[legs.length - 1];
  const mid = (yOf(top) + yOf(bottom)) / 2;

  function pose(tt: number, dt: number) {
    const leg = legAt(tt);
    const k = clamp((tt - leg.t0) / (leg.t1 - leg.t0), 0, 1);
    const p = leg.a.clone().lerp(leg.b, leg.kind === "ride" ? ease(k) : k);
    let lift = 0;
    const body = bot.getObjectByName("body")!;
    const shadow = bot.getObjectByName("shadow")!;
    if (leg.kind === "hop" || leg.kind === "party") {
      const ph = (tt - leg.t0) * (leg.kind === "party" ? 2.6 : 1.8);
      lift = Math.abs(Math.sin(ph * Math.PI)) * (leg.kind === "party" ? 1.0 : 0.7);
      const squash = 1 - Math.max(0, 0.18 - lift * 0.4);
      body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    } else {
      lift = leg.kind === "walk" ? Math.abs(Math.sin(tt * Math.PI * 4.2)) * 0.16 : 0;
      body.scale.set(1, 1, 1);
    }
    if (leg.kind === "walk") {
      const d = leg.b.clone().sub(leg.a);
      if (d.lengthSq() > 1e-4) {
        const want = Math.atan2(d.x, d.z);
        let delta = want - facing;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        facing += delta * (1 - Math.exp(-12 * dt));
      }
    } else if (leg.kind === "party" && ts) {
      facing = Math.atan2(ts.normal.x, ts.normal.y) + Math.sin((tt - leg.t0) * 7) * 0.3;
    } else if (leg.kind === "hop") {
      facing = 0; // looking at the camera, in the street
    }
    bot.position.copy(p);
    body.position.y = lift;
    bot.rotation.y = facing;
    shadow.scale.setScalar(1 - lift * 0.45);
    // the lift's cabin carries the radish, then waits on the shop's floor
    cabin.position.y = leg.kind === "ride" ? p.y : tt >= rideEnd ? tY : SLAB / 2;

    // the floors above the shop's fade away once the radish is up, so its floor shows from above
    const fade = clamp((tt - (rideEnd - 0.6)) / 1.2, 0, 1);
    for (const a of above) a.m.opacity = a.base * (1 - fade * 0.85);
    if (ts) {
      const pulse = 0.5 + 0.5 * Math.sin(tt * 3.2);
      ts.fill.opacity = 0.42 + 0.22 * pulse;
      glow.intensity = (tt > rideEnd ? 18 : 6) * (0.6 + 0.4 * pulse);
      if (beam) (beam.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.1 * pulse;
      if (shopTag) (shopTag.material as THREE.SpriteMaterial).opacity = clamp((tt - (arriveAt - 1.2)) / 0.8, 0, 1);
    }

    // the camera
    const look = p.clone().add(v3(0, 1.1, 0));
    const toShop = ts ? ts.center.clone() : look.clone();
    if (tt < legs[0].t1) {
      const k2 = ease(clamp(tt / legs[0].t1, 0, 1));
      wantPos.copy(v3(8, 36, 122)).lerp(v3(7, 3.4, HZ + 17), k2);
      wantLook.copy(v3(0, mid, 0)).lerp(look, k2);
    } else if (leg.kind === "ride") {
      wantPos.set(EX + 17, p.y + 3.5, EZ + 21);
      wantLook.copy(look);
    } else if (tt < rideEnd) {
      const back = v3(Math.sin(facing), 0, Math.cos(facing)).multiplyScalar(-9);
      wantPos.copy(p).add(back).add(v3(1.5, 3.2, 0));
      wantLook.copy(look);
    } else if (tt < arriveAt) {
      const back = v3(Math.sin(facing), 0, Math.cos(facing)).multiplyScalar(-11);
      wantPos.copy(p).add(back).add(v3(0, 10, 0));
      wantLook.copy(look).lerp(toShop, 0.2);
    } else if (tt < outroAt && ts) {
      const side = v3(-ts.normal.x, 0, -ts.normal.y).multiplyScalar(14).add(v3(ts.normal.y * 5, 7, -ts.normal.x * 5));
      wantPos.copy(p).add(side);
      wantLook.copy(ts.center).lerp(look, 0.45);
    } else {
      const a = 0.75 + (tt - outroAt) * 0.07;
      wantPos.set(Math.sin(a) * 54, Math.max(tY, 0) + 26, Math.cos(a) * 54);
      wantLook.set((ts?.center.x ?? 0) * 0.8, tY + 1, (ts?.center.z ?? 0) * 0.8);
    }
    const s = 1 - Math.exp(-(tt < legs[0].t1 ? 6 : 3.2) * dt);
    camPos.lerp(wantPos, s);
    camLook.lerp(wantLook, s);
    if (!done) {
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }
    if (!arrived && tt >= arriveAt) {
      arrived = true;
      hooks.onArrive();
    }
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / Math.max(1, h);
    camera.fov = camera.aspect < 0.8 ? 56 : 42; // a tall phone screen needs a wider lens
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function advance(dt: number) {
    time += dt;
    pose(Math.min(time, END + 1e6), dt);
    if (!done && time >= END) {
      done = true; // the cinematic is over: the person can turn the model round
      controls.target.copy(camLook);
      controls.enabled = true;
    }
    if (done) controls.update();
    renderer.render(scene, camera);
  }
  function loop(now: number) {
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    if (!manualMode) advance(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    times: { arrive: arriveAt, end: END },
    replay() {
      time = 0; arrived = false; done = false; controls.enabled = false;
      camPos.set(70, 52, 96); camLook.set(0, 10, 0);
    },
    manual(on) { manualMode = on; lastNow = performance.now(); },
    step(dt) {
      advance(dt);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      bot.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      scene.traverse((o) => {
        const s = o as THREE.Sprite;
        if (s.isSprite) { (s.material as THREE.SpriteMaterial).map?.dispose(); s.material.dispose(); }
      });
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
