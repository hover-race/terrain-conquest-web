import * as THREE from 'three'

export const WEAPONS = Object.freeze({
  machineGun: { speed: 78, interval: 0.085, gravity: 9.8, lifetime: 3.5, radius: 0.06 },
  machineGunRed: { speed: 52, interval: 0.16, gravity: 9.8, lifetime: 3.5, radius: 0.07 },
  rocket: { speed: 44, interval: 1.9, gravity: 9.8, lifetime: 6, radius: 0.18 },
})

// Simulation is independent of rendering. Sweep every movement segment so fast
// rounds cannot tunnel through thin targets, even at low render frame rates.
export class ProjectileSystem {
  constructor({ onFire = () => {}, onMove = () => {}, onImpact = () => {}, onRemove = () => {}, capacity = 128 } = {}) {
    Object.assign(this, { onFire, onMove, onImpact, onRemove, capacity })
    this.projectiles = []
    this.cooldowns = Object.fromEntries(Object.keys(WEAPONS).map(type => [type, 0]))
    this.targets = []
    this.shots = 0
    this.hits = 0
    this.ray = new THREE.Ray()
    this.box = new THREE.Box3()
    this.hit = new THREE.Vector3()
  }

  fire(type, origin, direction) {
    const config = WEAPONS[type]
    if (!config || this.cooldowns[type] > 1e-8 || this.projectiles.length >= this.capacity) return null
    const projectile = {
      type, config, position: origin.clone(), previous: origin.clone(),
      velocity: direction.clone().normalize().multiplyScalar(config.speed), age: 0,
    }
    this.projectiles.push(projectile)
    this.cooldowns[type] = config.interval
    this.shots++
    this.onFire(projectile)
    return projectile
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return
    for (const type of Object.keys(this.cooldowns)) this.cooldowns[type] = Math.max(0, this.cooldowns[type] - dt)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.previous.copy(p.position)
      p.velocity.y -= p.config.gravity * dt
      p.position.addScaledVector(p.velocity, dt)
      p.age += dt
      const distance = p.position.distanceTo(p.previous)
      this.ray.set(p.previous, this.hit.subVectors(p.position, p.previous).normalize())
      let nearest = distance + 1
      let target = null
      for (const candidate of this.targets) {
        this.box.copy(candidate.box).expandByScalar(p.config.radius)
        if (this.ray.intersectBox(this.box, this.hit)) {
          const d = this.hit.distanceTo(p.previous)
          if (d <= distance && d < nearest) { nearest = d; target = candidate }
        }
      }
      let ground = false
      if (p.position.y <= p.config.radius && p.previous.y > p.config.radius) {
        const d = distance * (p.previous.y - p.config.radius) / (p.previous.y - p.position.y)
        if (d < nearest) { nearest = d; target = null; ground = true }
      }
      if (target || ground) {
        p.position.copy(this.ray.at(nearest, this.hit))
        if (target && target.scoring !== false) this.hits++
        this.onImpact(p, target)
      } else this.onMove(p, dt)
      if (target || ground || p.age >= p.config.lifetime) {
        this.onRemove(p)
        this.projectiles.splice(i, 1)
      }
    }
  }

  reset() {
    for (const p of this.projectiles) this.onRemove(p)
    this.projectiles.length = 0
    for (const type of Object.keys(this.cooldowns)) this.cooldowns[type] = 0
    this.shots = this.hits = 0
  }
}
