import * as THREE from 'three';

const quadVS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const type = THREE.HalfFloatType;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: true, samples: 0 });
    this.rtA = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);

    this.bright = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, threshold: { value: 1.0 } }, vertexShader: quadVS, fragmentShader: `
      uniform sampler2D tex; uniform float threshold; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); float k = max(0.0, l - threshold) / max(l, 0.0001); gl_FragColor = vec4(c * k, 1.0); }` });
    this.blur = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2() } }, vertexShader: quadVS, fragmentShader: `
      uniform sampler2D tex; uniform vec2 dir, texel; varying vec2 vUv;
      void main(){ vec2 o = dir * texel; vec3 c = texture2D(tex, vUv).rgb * 0.227;
        c += (texture2D(tex, vUv + o * 1.38).rgb + texture2D(tex, vUv - o * 1.38).rgb) * 0.316;
        c += (texture2D(tex, vUv + o * 3.23).rgb + texture2D(tex, vUv - o * 3.23).rgb) * 0.07;
        gl_FragColor = vec4(c, 1.0); }` });
    this.comp = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, blur: { value: 0 }, aberration: { value: 0 }, vignette: { value: 0.35 }, bloomStrength: { value: 0.6 },
        flash: { value: 0 }, tint: { value: new THREE.Color(1, 0.2, 0.3) }, center: { value: new THREE.Vector2(0.5, 0.52) }, time: { value: 0 }, wobble: { value: 0 } },
      vertexShader: quadVS, fragmentShader: `
      uniform sampler2D tScene, tBloom; uniform float blur, aberration, vignette, bloomStrength, flash, time, wobble; uniform vec3 tint; uniform vec2 center; varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        // speed wobble: a faint rolling warp at the edges
        uv += vec2(sin(uv.y * 9.0 + time * 23.0), cos(uv.x * 7.0 + time * 19.0)) * wobble * 0.003 * smoothstep(0.2, 0.7, length(uv - center));
        vec2 d = uv - center; float r = length(d);
        float mask = smoothstep(0.12, 0.8, r);
        float amt = blur * mask;
        vec3 col = vec3(0.0);
        for (int i = 0; i < 12; i++) { float t = float(i) / 11.0; col += texture2D(tScene, center + d * (1.0 - amt * t * 0.45)).rgb; }
        col /= 12.0;
        float ca = aberration * mask;
        if (ca > 0.001) { col.r = mix(col.r, texture2D(tScene, center + d * (1.0 + ca * 0.025)).r, 0.6); col.b = mix(col.b, texture2D(tScene, center + d * (1.0 - ca * 0.025)).b, 0.6); }
        col += texture2D(tBloom, uv).rgb * bloomStrength;
        col *= 1.0 - vignette * smoothstep(0.45, 1.15, r);
        col = mix(col, tint * (0.6 + col), flash);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.comp.toneMapped = true;
  }
  setSize(w, h, pr) {
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.rtScene.setSize(W, H);
    const bw = Math.max(1, Math.floor(W / 4)), bh = Math.max(1, Math.floor(H / 4));
    this.rtA.setSize(bw, bh); this.rtB.setSize(bw, bh);
    this.blur.uniforms.texel.value.set(1 / bw, 1 / bh);
  }
  pass(mat, target) {
    this.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(this.scene, this.cam);
  }
  render(scene, camera, p) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene); r.clear(); r.render(scene, camera);
    this.bright.uniforms.tex.value = this.rtScene.texture; this.bright.uniforms.threshold.value = p.threshold ?? 0.9; this.pass(this.bright, this.rtA);
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tex.value = this.rtA.texture; this.blur.uniforms.dir.value.set(1, 0); this.pass(this.blur, this.rtB);
      this.blur.uniforms.tex.value = this.rtB.texture; this.blur.uniforms.dir.value.set(0, 1); this.pass(this.blur, this.rtA);
    }
    const u = this.comp.uniforms;
    u.tScene.value = this.rtScene.texture; u.tBloom.value = this.rtA.texture;
    u.blur.value = p.blur; u.aberration.value = p.aberration; u.bloomStrength.value = p.bloom; u.flash.value = p.flash; u.time.value = p.time; u.wobble.value = p.wobble;
    u.vignette.value = p.vignette ?? 0.35;
    if (p.tint) u.tint.value.copy(p.tint);
    this.pass(this.comp, null);
  }
}
