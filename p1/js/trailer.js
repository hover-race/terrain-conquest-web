import { findSingleNode } from './util.js'

export class Trailer {
  vehicle
  tuning
  chassis
  wheelMeshes = {}
  wheelRadius = 0.35

  constructor(sceneContext, position, modelPath = '/assets/glb/small-trailer.glb') {
    this.scene = sceneContext
    this.physics = sceneContext.physics

    const root = sceneContext.getGltf(modelPath).scene.clone(true)
    this.setupShadowProperties(root)
    this.findNodes(root)
    this.setupWheelMeshes()
    this.setupChassis(position)
    this.setupPhysics()
    this.setupVehicle()
    this.setBrakes(true)
  }

  setupShadowProperties(root) {
    root.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }

  findNodes(root) {
    this.chassis = findSingleNode(root, 'body')
    this.wheelMeshes = {}
    for (const [name, nodeName] of Object.entries({
      frontLeft: 'wheel_FL', frontRight: 'wheel_FR', rearLeft: 'wheel_RL', rearRight: 'wheel_RR',
    })) {
      const wheel = root.getObjectByName(nodeName)
      if (wheel) this.wheelMeshes[name] = wheel
    }
    if (![2, 4].includes(Object.keys(this.wheelMeshes).length)) {
      throw new Error('Trailer must have two or four wheel mounts.')
    }
    this.hitchReceiver = findSingleNode(root, 'hitchReceiver')

    const radius = Object.values(this.wheelMeshes)[0].userData.physics_radius
    if (typeof radius === 'number') this.wheelRadius = radius
  }

  setupWheelMeshes() {
    const wheelModel = this.scene.getGltf('/assets/glb/truck-wheel.glb').scene
    // The tire is centered on the X axle with an unscaled radius of 0.515 m.
    const modelRadius = 0.515
    for (const [name, marker] of Object.entries(this.wheelMeshes)) {
      const wheel = new THREE.Group()
      wheel.name = marker.name
      wheel.position.copy(marker.position)
      wheel.userData = { ...marker.userData }

      const visual = wheelModel.clone(true)
      visual.scale.setScalar((marker.userData.physics_radius ?? this.wheelRadius) / modelRadius)
      // Flip each side so the hub face points inward toward the trailer.
      if (marker.position.x > 0) visual.rotation.y = Math.PI
      wheel.add(visual)
      this.setupShadowProperties(wheel)
      marker.removeFromParent()
      this.wheelMeshes[name] = wheel
    }
  }

  setupChassis(position) {
    // The physics engine removes bodies by name; each spawned trailer needs its own.
    this.chassis.name = `trailer-${this.chassis.uuid}`
    this.chassis.position.copy(position)
    this.scene.add.existing(this.chassis)
    for (const wheel of Object.values(this.wheelMeshes)) this.scene.add.existing(wheel)

    const hitchLocal = this.hitchReceiver.position.clone()
    this.chassis.add(this.hitchReceiver)
    this.hitchReceiver.position.copy(hitchLocal)
  }

  setupPhysics() {
    const mass = this.chassis.userData.physics_mass ?? 1500
    const shape = this.chassis.userData.physics_shape ?? 'convex'

    this.physics.add.existing(this.chassis, {
      shape,
      mass,
      collisionGroup: 1 | 2,
      collisionMask: 1 | 2,
    })
    this.chassis.body.setDamping(0.2, 0.2)

    if (!this.chassis.body || !this.chassis.body.ammo) {
      throw new Error('Trailer chassis physics body not found.')
    }
  }

  setupVehicle() {
    const { physicsWorld } = this.physics
    // This Ammo build exposes no tuning destructor; share one for the scene lifetime.
    this.tuning = this.scene.trailerTuning ??= new Ammo.btVehicleTuning()
    this.rayCaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld)
    this.vehicle = new Ammo.btRaycastVehicle(this.tuning, this.chassis.body.ammo, this.rayCaster)

    this.chassis.body.skipUpdate = true
    this.vehicle.setCoordinateSystem(0, 1, 2)
    physicsWorld.addAction(this.vehicle)
    this.vehicleInWorld = true

    for (const [name, wheel] of Object.entries(this.wheelMeshes)) {
      this.addWheel(wheel, name.startsWith('front'))
    }
    this.wheelMounts = Object.values(this.wheelMeshes).map(wheel => wheel.position.clone())
    this.vehicle.resetSuspension()
  }

  addWheel(wheelMesh, isFront) {
    const radius = wheelMesh.userData.physics_radius ?? this.wheelRadius
    const pos = new Ammo.btVector3(wheelMesh.position.x, wheelMesh.position.y, wheelMesh.position.z)

    const wheelDirectionCS0 = new Ammo.btVector3(0, -1, 0)
    const wheelAxleCS = new Ammo.btVector3(-1, 0, 0)

    const suspensionRestLength = 0.05
    const maxSuspensionTravelCm = 25

    this.tuning.set_m_maxSuspensionTravelCm(maxSuspensionTravelCm)

    const wheelInfo = this.vehicle.addWheel(
      pos,
      wheelDirectionCS0,
      wheelAxleCS,
      suspensionRestLength,
      radius,
      this.tuning,
      isFront
    )

    // Trailer suspension settings.
    wheelInfo.set_m_suspensionStiffness(120.0)
    wheelInfo.set_m_wheelsDampingRelaxation(6.0)
    wheelInfo.set_m_wheelsDampingCompression(8.0)
    wheelInfo.set_m_frictionSlip(2.0)
    wheelInfo.set_m_rollInfluence(0.3)
    wheelInfo.set_m_maxSuspensionTravelCm(maxSuspensionTravelCm)
    wheelInfo.set_m_maxSuspensionForce(60000)
    Ammo.destroy(pos)
    Ammo.destroy(wheelDirectionCS0)
    Ammo.destroy(wheelAxleCS)
  }

  setBrakes(enabled) {
    for (let i = 0; i < this.vehicle.getNumWheels(); i++) {
      this.vehicle.setBrake(enabled ? 100 : 0, i)
    }
  }

  setParked(parked) {
    if (this.parked === parked) return
    this.parked = parked
    const body = this.chassis.body.ammo
    if (parked) {
      this.unparkedCollisionFlags = body.getCollisionFlags()
      const zero = new Ammo.btVector3(0, 0, 0)
      body.setLinearVelocity(zero)
      body.setAngularVelocity(zero)
      body.setMassProps(0, zero)
      body.setCollisionFlags(this.unparkedCollisionFlags | 1)
      body.updateInertiaTensor()
      Ammo.destroy(zero)
      this.physics.physicsWorld.removeAction(this.vehicle)
      this.vehicleInWorld = false
    } else {
      const mass = this.chassis.userData.physics_mass ?? 1500
      const inertia = new Ammo.btVector3(0, 0, 0)
      body.getCollisionShape().calculateLocalInertia(mass, inertia)
      body.setMassProps(mass, inertia)
      body.setCollisionFlags(this.unparkedCollisionFlags)
      body.updateInertiaTensor()
      Ammo.destroy(inertia)
      this.physics.physicsWorld.addAction(this.vehicle)
      this.vehicleInWorld = true
      this.vehicle.resetSuspension()
      body.activate(true)
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.vehicleInWorld) this.physics.physicsWorld.removeAction(this.vehicle)
    Ammo.destroy(this.vehicle)
    Ammo.destroy(this.rayCaster)
    this.physics.destroy(this.chassis)
    this.chassis.removeFromParent()
    for (const wheel of Object.values(this.wheelMeshes)) wheel.removeFromParent()
  }

  update() {
    let tm, p, q, i
    const n = this.vehicle.getNumWheels()
    const wheelArray = Object.values(this.wheelMeshes)

    tm = this.vehicle.getChassisWorldTransform()
    p = tm.getOrigin()
    q = tm.getRotation()
    this.chassis.position.set(p.x(), p.y(), p.z())
    this.chassis.quaternion.set(q.x(), q.y(), q.z(), q.w())

    for (i = 0; i < n; i++) {
      if (this.parked) {
        wheelArray[i].position.copy(this.wheelMounts[i])
          .applyQuaternion(this.chassis.quaternion).add(this.chassis.position)
        wheelArray[i].quaternion.copy(this.chassis.quaternion)
        continue
      }
      tm = this.vehicle.getWheelTransformWS(i)
      p = tm.getOrigin()
      q = tm.getRotation()
      wheelArray[i].position.set(p.x(), p.y(), p.z())
      wheelArray[i].quaternion.set(q.x(), q.y(), q.z(), q.w())
    }

  }
}
