import * as THREE from 'three'

const fullscreenVertex = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

// Retain square particles at world-space positions in a separate post layer.
// Full-resolution projection keeps their movement smooth as the camera orbits.
export class RedTrailPass {
  constructor(renderer, capacity = 1024) {
    this.renderer = renderer
    this.capacity = capacity
    this.lifetime = 0.22
    this.time = 0
    this.cursor = 0
    this.particleSize = 0.4
    this.particles = Array.from({ length: capacity }, () => ({
      position: new THREE.Vector3(), born: -Infinity,
    }))
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    this.sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
    const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }
    this.trailTarget = new THREE.WebGLRenderTarget(1, 1, options)
    this.positions = new Float32Array(capacity * 6 * 3)
    this.strengths = new Float32Array(capacity * 6)
    const corners = new Float32Array(capacity * 6 * 2)
    const squareCorners = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]
    for (let i = 0; i < capacity; i++) corners.set(squareCorners, i * 12)
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2))
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('strength', new THREE.BufferAttribute(this.strengths, 1).setUsage(THREE.DynamicDrawUsage))
    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: { sceneDepth: { value: this.sceneTarget.depthTexture }, resolution: { value: new THREE.Vector2() }, particleSize: { value: this.particleSize } },
      vertexShader: `
        attribute float strength;
        attribute vec2 corner;
        uniform float particleSize;
        varying float vStrength;
        void main() {
          vStrength = strength;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          // Camera-facing square with a world-space size, never snapped to pixels.
          viewPosition.xy += corner * particleSize * 0.5 * mix(0.65, 1.0, strength);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D sceneDepth;
        uniform vec2 resolution;
        varying float vStrength;
        void main() {
          float depth = texture2D(sceneDepth, gl_FragCoord.xy / resolution).r;
          if (gl_FragCoord.z > depth + 0.000002) discard;
          gl_FragColor = vec4(vec3(3.0, 0.018, 0.008) * vStrength, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending, transparent: true,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    })
    this.trailScene = new THREE.Scene()
    const mesh = new THREE.Mesh(this.geometry, this.trailMaterial)
    mesh.frustumCulled = false
    this.trailScene.add(mesh)
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        base: { value: this.sceneTarget.texture }, trails: { value: this.trailTarget.texture },
        intensity: { value: 1 },
      },
      vertexShader: fullscreenVertex,
      fragmentShader: `
        uniform sampler2D base;
        uniform sampler2D trails;
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          vec3 color = texture2D(base, vUv).rgb;
          color += texture2D(trails, vUv).rgb * intensity;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      depthTest: false, depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial)
    this.postScene = new THREE.Scene()
    this.postScene.add(this.quad)
    this.postCamera = new THREE.Camera()
    this.size = new THREE.Vector2()
    this.clearColor = new THREE.Color()
    this.resize()
  }

  add(start, end, duration = 0) {
    // Fill long simulation steps without making particle density frame-dependent.
    const count = Math.min(this.capacity, Math.max(1, Math.ceil(start.distanceTo(end) / 0.5)))
    for (let i = 1; i <= count; i++) {
      const particle = this.particles[this.cursor]
      particle.position.lerpVectors(start, end, i / count)
      particle.born = this.time - duration * (1 - i / count)
      this.cursor = (this.cursor + 1) % this.capacity
    }
  }

  update(dt) { this.time += dt }

  clear() {
    for (const particle of this.particles) particle.born = -Infinity
    this.geometry.setDrawRange(0, 0)
  }

  resize() {
    this.renderer.getDrawingBufferSize(this.size)
    this.sceneTarget.setSize(this.size.x, this.size.y)
    this.trailTarget.setSize(this.size.x, this.size.y)
    this.trailMaterial.uniforms.resolution.value.set(this.trailTarget.width, this.trailTarget.height)
  }

  render(scene, camera, intensity = 1, timeOffset = 0) {
    let vertex = 0
    for (const particle of this.particles) {
      const age = this.time + timeOffset - particle.born
      if (age < 0 || age >= this.lifetime) continue
      const strength = Math.pow(1 - age / this.lifetime, 1.5)
      for (let i = 0; i < 6; i++) {
        this.positions[vertex * 3] = particle.position.x
        this.positions[vertex * 3 + 1] = particle.position.y
        this.positions[vertex * 3 + 2] = particle.position.z
        this.strengths[vertex++] = strength
      }
    }
    this.trailMaterial.uniforms.particleSize.value = this.particleSize
    this.geometry.setDrawRange(0, vertex)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.strength.needsUpdate = true
    const renderer = this.renderer
    const previousTarget = renderer.getRenderTarget()
    const previousAutoClear = renderer.autoClear
    renderer.getClearColor(this.clearColor)
    const previousAlpha = renderer.getClearAlpha()
    renderer.autoClear = true
    renderer.setRenderTarget(this.sceneTarget)
    renderer.render(scene, camera)
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderTarget(this.trailTarget)
    renderer.render(this.trailScene, camera)
    this.compositeMaterial.uniforms.intensity.value = intensity
    renderer.setRenderTarget(previousTarget)
    renderer.render(this.postScene, this.postCamera)
    renderer.setClearColor(this.clearColor, previousAlpha)
    renderer.autoClear = previousAutoClear
  }

  dispose() {
    for (const target of [this.sceneTarget, this.trailTarget]) target.dispose()
    this.geometry.dispose()
    this.trailMaterial.dispose()
    this.compositeMaterial.dispose()
    this.quad.geometry.dispose()
  }
}
