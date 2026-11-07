import * as THREE from 'three'

// Bounded, recycled sprites keep sustained automatic fire from accumulating GPU resources.
export class ProjectileEffects {
  constructor(scene, capacity = 700) {
    this.scene = scene
    this.intensity = 1
    this.enabled = true
    this.smokeEnabled = true
    this.lightsEnabled = true
    this.active = []
    this.free = []
    this.capacity = capacity
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.13, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.65)')
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.16)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    // An opaque 1×1 texel expands into a hard-edged, screen-aligned square.
    this.squareTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    this.squareTexture.minFilter = this.squareTexture.magFilter = THREE.NearestFilter
    this.squareTexture.generateMipmaps = false
    this.squareTexture.needsUpdate = true
    this.lights = Array.from({ length: 6 }, () => {
      const light = new THREE.PointLight(0xffa24e, 0, 20, 2)
      scene.add(light)
      return light
    })
    this.lightIndex = 0
  }

  emit(position, { color = 0xffb45b, size = 1, endSize = 0, life = 0.2, velocity = new THREE.Vector3(), smoke = false, opacity = 1, gravity = 0, square = false } = {}) {
    if (!this.enabled || (smoke && !this.smokeEnabled) || this.active.length >= this.capacity) return
    const sprite = this.free.pop() || new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, toneMapped: false }))
    sprite.position.copy(position)
    sprite.material.map = square ? this.squareTexture : this.texture
    sprite.material.color.setHex(color)
    sprite.material.blending = smoke ? THREE.NormalBlending : THREE.AdditiveBlending
    sprite.material.opacity = opacity
    sprite.material.rotation = Math.random() * Math.PI * 2
    // Pick a steady, slow spin per explosion particle (about 9–26 degrees/sec).
    const angularVelocity = square ? (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.3) : 0
    sprite.scale.setScalar(size)
    sprite.visible = true
    this.scene.add(sprite)
    this.active.push({ sprite, size, endSize, life, age: 0, velocity: velocity.clone(), smoke, opacity, gravity, angularVelocity })
  }

  flash(position, rocket = false, square = false) {
    this.emit(position, { square, color: 0xfff5d8, size: rocket ? 3.5 : 1.8, endSize: 0.2, life: 0.07 })
    this.emit(position, { square, size: rocket ? 9 : 5, endSize: 0.1, life: 0.12, opacity: 0.5 })
    this.light(position, rocket ? 100 : 35)
  }

  light(position, power) {
    if (!this.lightsEnabled) return
    const light = this.lights[this.lightIndex++ % this.lights.length]
    light.position.copy(position)
    light.intensity = power * this.intensity
  }

  // Machine-gun hit: a brief flash, small sparks, and dust.
  impact1(position) {
    // this.flash(position, false, true)
    for (let i = 0; i < 7; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).multiplyScalar(8)
      this.emit(position, {
        square: true, color: i % 2 ? 0xffd395 : 0xff8b31,
        size: 0.3 + Math.random() * 0.2, life: 0.3 + Math.random() * 0.7,
        velocity, gravity: 10,
      })
    }
    for (let i = 0; i < 2; i++) {
      this.emit(position, {
        square: true, color: 0xbcb296, smoke: true,
        size: 0.4, endSize: 1.5, life: 0.6, opacity: 0.38,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 2),
      })
    }
  }

  // Rocket explosion: slowly drifting fire, larger sparks, and lingering smoke.
  impact2(position) {
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2 + Math.random() * 0.4
      const speed = 1 + Math.random() * 1.5
      const velocity = new THREE.Vector3(Math.cos(angle) * speed, 0.6 + Math.random(), Math.sin(angle) * speed)
      this.emit(position, {
        square: true, color: i % 2 ? 0xffa33f : 0xffce7a,
        size: 0.7 + Math.random() * 0.5, endSize: 1.5 + Math.random() * 0.8,
        life: 1.2 + Math.random() * 0.7, opacity: 0.65, velocity,
      })
    }
    this.light(position, 150)
    for (let i = 0; i < 35; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).multiplyScalar(8)
      this.emit(position, {
        square: true, color: i % 2 ? 0xffd395 : 0xff8b31,
        size: 0.8 + Math.random() * 0.8, life: 0.8 + Math.random() * 0.7,
        velocity, gravity: 3,
      })
    }
    for (let i = 0; i < 16; i++) {
      this.emit(position, {
        square: true, color: 0x72695a, smoke: true,
        size: 0.9, endSize: 3, life: 3.5, opacity: 0.38,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 2),
      })
    }
  }

  update(dt) {
    for (const light of this.lights) light.intensity *= Math.exp(-22 * dt)
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]
      p.age += dt
      const t = Math.min(1, p.age / p.life)
      p.velocity.y -= p.gravity * dt
      p.sprite.position.addScaledVector(p.velocity, dt)
      p.sprite.material.rotation += p.angularVelocity * dt
      p.sprite.scale.setScalar(THREE.MathUtils.lerp(p.size, p.endSize, t))
      p.sprite.material.opacity = p.opacity * (1 - t) * (p.smoke ? 1 : this.intensity)
      if (t === 1 || !this.enabled || (p.smoke && !this.smokeEnabled)) {
        p.sprite.visible = false
        this.scene.remove(p.sprite)
        this.free.push(p.sprite)
        this.active.splice(i, 1)
      }
    }
  }

  clear() {
    for (const p of this.active) { this.scene.remove(p.sprite); this.free.push(p.sprite) }
    this.active.length = 0
    for (const light of this.lights) light.intensity = 0
  }

  dispose() {
    this.clear()
    for (const sprite of this.free) sprite.material.dispose()
    this.free.length = 0
    this.texture.dispose()
    this.squareTexture.dispose()
    for (const light of this.lights) this.scene.remove(light)
  }
}
