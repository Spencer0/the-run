import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
function segment(radius, mat) {
  const g = new THREE.CylinderGeometry(radius, radius * 0.8, 1, 8); g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}
function orient(mesh, a, b) {
  mesh.position.copy(a); _d.subVectors(b, a); const l = _d.length(); mesh.scale.set(1, l, 1); _d.normalize(); mesh.quaternion.setFromUnitVectors(UP, _d);
}

export class Mech {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    const shell = new THREE.MeshStandardMaterial({ color: 0x1f3540, roughness: 0.35, metalness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6, metalness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.95, metalness: 0.0 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x37e8ff, emissiveIntensity: 2.5, roughness: 0.3 });
    this.exhaustMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff7a1a, emissiveIntensity: 0.6, roughness: 0.3 });
    this.mats = { shell, accent, dark, rubber, glow };

    // --- body ---
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), shell); hull.scale.set(0.95, 0.5, 1.25); hull.position.y = 1.1; hull.castShadow = true; this.body.add(hull);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.5), dark); plate.position.set(0, 1.12, -1.05); this.body.add(plate);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.08), glow); eye.position.set(sx * 0.3, 1.18, -1.3); this.body.add(eye);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 1.3), accent); panel.position.set(sx * 0.82, 1.18, 0.1); panel.rotation.z = sx * 0.4; this.body.add(panel);
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.6, 10), dark); ex.rotation.x = Math.PI / 2; ex.position.set(sx * 0.42, 1.2, 1.35); this.body.add(ex);
      const exg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10), this.exhaustMat); exg.rotation.x = Math.PI / 2; exg.position.set(sx * 0.42, 1.2, 1.62); this.body.add(exg);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 2.2), accent); spine.position.set(0, 1.56, 0.05); this.body.add(spine);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 6), dark); ant.position.set(-0.6, 1.95, 0.9); ant.rotation.z = 0.3; this.body.add(ant);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3b5c, emissiveIntensity: 3 })); bulb.position.set(-0.73, 2.4, 0.9); this.body.add(bulb);
    this.bulb = bulb;

    // --- gnome rider ---
    const rider = new THREE.Group(); rider.position.set(0, 1.62, 0.15); this.body.add(rider); this.rider = rider;
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0b48a, roughness: 0.7 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2b55a8, roughness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd4281e, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.7, 10), cloth); torso.position.y = 0.3; torso.castShadow = true; rider.add(torso);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 14), dark); belt.position.y = 0.2; belt.rotation.x = Math.PI / 2; rider.add(belt);
    const head = new THREE.Group(); head.position.y = 0.82; rider.add(head); this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), skin); head.add(skull);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), skin); nose.position.set(0, -0.04, -0.27); head.add(nose);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 8), white); beard.position.set(0, -0.3, -0.12); beard.rotation.x = 0.35; head.add(beard); this.beard = beard;
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), dark); e.position.set(sx * 0.1, 0.04, -0.24); head.add(e); }
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 20), dark); goggles.position.set(0, 0.17, 0); goggles.rotation.x = Math.PI / 2; head.add(goggles);
    for (const sx of [-1, 1]) { const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 10), glow); lens.position.set(sx * 0.12, 0.17, -0.27); lens.rotation.x = Math.PI / 2; head.add(lens); }
    const hat = new THREE.Group(); hat.position.y = 0.2; head.add(hat); this.hat = hat;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.08, 14), red); hat.add(brim);
    const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 12), red); cone1.position.y = 0.3; hat.add(cone1);
    const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 10), red); cone2.position.set(0, 0.68, 0.12); cone2.rotation.x = 0.5; hat.add(cone2);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), white); tip.position.set(0, 0.86, 0.25); hat.add(tip);
    // arms to handlebar
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), dark); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.55, -0.42); rider.add(bar);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), cloth); arm.position.set(sx * 0.25, 0.5, -0.22); arm.rotation.x = -1.1; arm.rotation.z = sx * -0.25; rider.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), skin); hand.position.set(sx * 0.3, 0.55, -0.42); rider.add(hand);
    }
    // scarf
    this.scarf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.7), accent); this.scarf.position.set(0.05, 0.6, 0.45); rider.add(this.scarf);

    // --- legs ---
    this.legs = [];
    const zs = [-0.95, -0.35, 0.3, 0.9];
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const z = zs[i];
      const hipPos = new THREE.Vector3(side * 0.75, 1.0, z);
      const hip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), accent); hip.position.copy(hipPos); this.body.add(hip);
      const upper = segment(0.11, shell); this.root.add(upper);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), dark); this.root.add(knee);
      const lower = segment(0.08, dark); this.root.add(lower);
      const wheel = new THREE.Group(); this.root.add(wheel);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 16), rubber); tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; wheel.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 8), accent); hub.rotation.z = Math.PI / 2; wheel.add(hub);
      const hubGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 8), glow); hubGlow.rotation.z = Math.PI / 2; wheel.add(hubGlow);
      for (let k = 0; k < 3; k++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.5), dark); spoke.rotation.x = (k / 3) * Math.PI; wheel.add(spoke); }
      this.legs.push({ side, i, hipPos, hip, upper, knee, lower, wheel, phase: (i * 0.9 + (side > 0 ? 0.45 : 0)) * Math.PI, spin: 0,
        rest: new THREE.Vector3(side * 1.55, 0.36, z + (i < 2 ? -0.25 : 0.25)), kneeRest: new THREE.Vector3(side * 1.5, 1.55, z) });
    }
    this.t = 0; this.squash = 0; this.airT = 0; this.bank = 0; this.yaw = 0;
    this.footTargets = this.legs.map((l) => l.rest.clone());
    this.kneeTargets = this.legs.map((l) => l.kneeRest.clone());
  }

  // state: { speed, maxSpeed, vx, vy, grounded, boost, hit, dt }
  update(dt, st) {
    this.t += dt;
    const sf = Math.min(1, st.speed / Math.max(1, st.maxSpeed));
    const grounded = st.grounded && !st.zip;
    this.airT = grounded ? Math.max(0, this.airT - dt * 6) : Math.min(1, this.airT + dt * 5);
    if (st.landed) this.squash = 1;
    this.squash = Math.max(0, this.squash - dt * 4);
    const sq = Math.sin(this.squash * Math.PI) * 0.25;

    // body motion
    const bob = grounded ? Math.sin(this.t * (8 + sf * 14)) * 0.035 * (0.4 + sf) : 0;
    this.body.position.y = bob - sq * 0.6 + this.airT * 0.35;
    this.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.3);
    const targetBank = THREE.MathUtils.clamp(-st.vx * 0.045, -0.5, 0.5);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 8);
    const targetYaw = THREE.MathUtils.clamp(-st.vx * 0.02, -0.35, 0.35);
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 6);
    this.root.rotation.set(st.zip ? 0.15 : grounded ? -sf * 0.08 : THREE.MathUtils.clamp(-st.vy * 0.02, -0.35, 0.3), this.yaw, this.bank + (st.grind ? Math.sin(this.t * 9) * 0.05 : 0));

    // rider
    const lean = -sf * 0.35 - (grounded ? 0 : 0.15);
    this.rider.rotation.x = lean + Math.sin(this.t * 10) * 0.02 * sf;
    this.head.rotation.x = -lean * 0.6;
    this.hat.rotation.x = 0.25 * sf + Math.sin(this.t * 17) * 0.06 * sf;
    this.beard.rotation.x = 0.35 + 0.5 * sf + Math.sin(this.t * 23) * 0.12 * sf;
    this.scarf.rotation.x = -0.4 - sf * 0.6 + Math.sin(this.t * 19) * 0.25 * (0.3 + sf);
    this.scarf.scale.z = 1 + sf * 0.8;
    this.exhaustMat.emissiveIntensity = 0.5 + sf * 2 + (st.boost ? 3 : 0) + Math.sin(this.t * 40) * 0.3 * sf;
    this.bulb.material.emissiveIntensity = 2 + Math.sin(this.t * 6) * 2;

    // legs: trot when grounded, tuck when airborne
    for (let k = 0; k < this.legs.length; k++) {
      const l = this.legs[k];
      const ft = this.footTargets[k], kt = this.kneeTargets[k];
      ft.copy(l.rest); kt.copy(l.kneeRest);
      if (st.grind) {
        // wheels pulled together onto the rail, like skates
        ft.x = l.side * 0.55; ft.y = 0.36; ft.z = l.rest.z * 1.1; kt.x = l.side * 1.3; kt.y = 1.45;
      } else if (grounded) {
        const ph = this.t * (6 + sf * 10) + l.phase;
        ft.y += Math.max(0, Math.sin(ph)) * 0.08 * (0.3 + sf);
        ft.z += Math.cos(ph) * 0.12 * sf;
        kt.y += Math.sin(ph) * 0.1;
        ft.x += Math.sin(this.t * 2 + k) * 0.03;
      } else {
        // pull wheels up and in, like a cat mid-leap
        ft.x = l.side * 1.15; ft.y = 1.05; ft.z = l.rest.z * 1.25;
        kt.x = l.side * 1.7; kt.y = 1.75;
      }
      // smooth
      l.wheel.position.lerp(ft, Math.min(1, dt * 14));
      l.knee.position.lerp(kt, Math.min(1, dt * 14));
      const hipW = l.hipPos.clone().add(this.body.position);
      orient(l.upper, hipW, l.knee.position);
      orient(l.lower, l.knee.position, l.wheel.position);
      l.spin -= (st.speed / 0.36) * dt;
      l.wheel.rotation.x = l.spin;
    }
  }
}
