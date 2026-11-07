import * as THREE from 'three'

/**
 * Couples truck.hitch to trailer.hitchReceiver.
 * UX: close → attract → lock joint → break under force/stretch.
 */
export class HitchCoupler {
  constructor(truck, trailer, opts = {}) {
    this.truck = truck
    this.trailer = trailer
    this.physics = truck.physics

    this.attractRadius = opts.attractRadius ?? 5
    this.lockRadius = opts.lockRadius ?? 0.75
    this.breakDistance = opts.breakDistance ?? 2.2
    this.breakImpulse = opts.breakImpulse ?? 2500
    this.attractStrength = opts.attractStrength ?? 1
    this.reacquireDelay = opts.reacquireDelay ?? 1.5

    this.coupled = false
    this.connecting = false
    this.constraint = null
    this.cooldown = 0
    this.waitingForSeparation = false

    this._worldA = new THREE.Vector3()
    this._worldB = new THREE.Vector3()
    this._dir = new THREE.Vector3()
  }

  update(deltaTime) {
    this.connecting = false
    if (this.cooldown > 0) this.cooldown -= deltaTime

    this.truck.hitch.getWorldPosition(this._worldA)
    this.trailer.hitchReceiver.getWorldPosition(this._worldB)
    const dist = this._worldA.distanceTo(this._worldB)

    if (this.coupled) {
      this._checkBreak(dist)
      return
    }

    // A manual drop stays released until the truck leaves the attraction zone.
    if (this.waitingForSeparation) {
      if (dist < this.attractRadius) return
      this.waitingForSeparation = false
    }

    if (this.cooldown > 0) return

    if (dist < this.lockRadius) {
      this._lock()
    } else if (dist < this.attractRadius) {
      this.connecting = true
      this._attract(dist, deltaTime)
    }
  }

  _attract(dist, deltaTime) {
    this._dir.subVectors(this._worldB, this._worldA)
    if (this._dir.lengthSq() < 1e-8) return
    this._dir.normalize()

    const t = 1 - dist / this.attractRadius
    const mag = this.attractStrength * t * t * Math.max(deltaTime, 1 / 120)
    this._applyImpulse(this.truck.chassis, this._worldA, this._dir, mag)
    this._applyImpulse(this.trailer.chassis, this._worldB, this._dir, -mag)
  }

  _applyImpulse(chassis, worldPoint, dir, magnitude) {
    const body = chassis.body?.ammo
    if (!body) return
    body.activate(true)

    const impulse = new Ammo.btVector3(dir.x * magnitude, dir.y * magnitude, dir.z * magnitude)
    const com = body.getWorldTransform().getOrigin()
    const rel = new Ammo.btVector3(
      worldPoint.x - com.x(),
      worldPoint.y - com.y(),
      worldPoint.z - com.z()
    )
    body.applyImpulse(impulse, rel)
    Ammo.destroy(impulse)
    Ammo.destroy(rel)
  }

  _lock() {
    const bodyA = this.truck.chassis.body.ammo
    const bodyB = this.trailer.chassis.body.ammo
    const pivotA = this.truck.hitch.position
    const pivotB = this.trailer.hitchReceiver.position

    const pa = new Ammo.btVector3(pivotA.x, pivotA.y, pivotA.z)
    const pb = new Ammo.btVector3(pivotB.x, pivotB.y, pivotB.z)
    this.constraint = new Ammo.btPoint2PointConstraint(bodyA, bodyB, pa, pb)
    // Disable collisions between the linked truck and trailer.
    this.physics.physicsWorld.addConstraint(this.constraint, true)
    Ammo.destroy(pa)
    Ammo.destroy(pb)

    this.coupled = true
    this.trailer.setBrakes(false)
    bodyA.activate(true)
    bodyB.activate(true)
  }

  _checkBreak(dist) {
    if (dist > this.breakDistance) {
      this._unlock()
      return
    }
    if (this.constraint.getAppliedImpulse) {
      const impulse = Math.abs(this.constraint.getAppliedImpulse())
      if (impulse > this.breakImpulse) this._unlock()
    }
  }

  _unlock() {
    if (this.constraint) {
      this.physics.physicsWorld.removeConstraint(this.constraint)
      Ammo.destroy(this.constraint)
      this.constraint = null
    }
    this.coupled = false
    this.cooldown = this.reacquireDelay
    this.trailer.setBrakes(true)
  }

  dispose() {
    this._unlock()
  }

  dropTrailer() {
    this.connecting = false
    this.waitingForSeparation = true
    if (!this.coupled) return false
    this._unlock()
    return true
  }
}
