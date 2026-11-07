import * as THREE from 'three'
import { createMuzzleFlash } from './particles.js'
import { playExplosionSound } from './sounds.js'
import { Bullet } from './bullet.js'
import { findSingleNode } from './util.js'
import { GunCamera } from './gunCamera.js'
import { isUiEvent } from './gameInput.js'

export const MIN_GUN_PITCH = -0.15
export const MAX_GUN_PITCH = 0.58

function lerpAngle(start, end, t) {
  let diff = end - start
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return start + diff * t
}

export class Vehicle {
  vehicle
  tuning
  chassis
  wheelMeshes = {}
  turretTraverseAxis
  turretElevationAxis
  gunElevationPivot
  gunCameraMount
  muzzlePoint
  bulletOrigin
  RTS_camera_pos
  turret

  engineForce = 0
  vehicleSteering = 0
  breakingForce = 0
  wheelRadius

  constructor(sceneContext, position) {
    this.scene = sceneContext
    this.physics = sceneContext.physics

    const carScene = sceneContext.getGltf('/assets/glb/blockbench-truck.glb').scene.clone()
    this.setupShadowProperties(carScene)
    this.findNodes(carScene)
    this.setupChassis(position)
    this.setupPhysics()
    this.setupVehicle()
    this.createMinimapSprite()
    this.turret = new VehicleTurret(this.turretTraverseAxis, this.bulletOrigin, this)
  }

  setupSceneContext(sceneContext) {
    this.scene = sceneContext.scene
    this.physics = sceneContext.physics
  }

  setupShadowProperties(carScene) {
    carScene.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }

  findNodes(carScene) {
    this.chassis = findSingleNode(carScene, 'body')
    this.turretTraverseAxis = findSingleNode(carScene, 'TurretVerticalAxis')
    this.turretElevationAxis = findSingleNode(carScene, 'GunBody')
    this.bulletOrigin = findSingleNode(carScene, 'BulletOrigin')
    this.RTS_camera_pos = findSingleNode(carScene, 'RTS_camera_pos')
    this.chassis.RTS_camera_pos = this.RTS_camera_pos
    this.gunCameraPos = findSingleNode(carScene, 'Scope')

    // Create a non-recoiling elevation cradle inside TurretVerticalAxis at GunBody's rest position.
    // GunBody (turretElevationAxis) sits inside gunElevationPivot and slides along -Z on recoil,
    // while gunCameraMount stays fixed on gunElevationPivot beside the gun barrel.
    this.gunElevationPivot = new THREE.Group()
    this.gunElevationPivot.name = 'GunElevationPivot'
    this.gunElevationPivot.position.copy(this.turretElevationAxis.position)
    this.turretTraverseAxis.add(this.gunElevationPivot)

    this.turretElevationAxis.position.set(0, 0, 0)
    this.gunElevationPivot.add(this.turretElevationAxis)

    this.gunCameraMount = new THREE.Object3D()
    this.gunCameraMount.name = 'GunSideCameraMount'
    this.gunCameraMount.position.set(0.32, 0.11, -0.28)
    this.gunElevationPivot.add(this.gunCameraMount)

    const bracketMat = new THREE.MeshStandardMaterial({
      color: 0x262d32,
      roughness: 0.6,
      metalness: 0.6,
    })
    const bracketArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.06), bracketMat)
    bracketArm.position.set(0.19, 0.05, -0.18)
    this.gunElevationPivot.add(bracketArm)

    const sightHousing = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.18), bracketMat)
    sightHousing.position.set(0.31, 0.09, -0.18)
    this.gunElevationPivot.add(sightHousing)

    this.muzzlePoint = new THREE.Object3D()
    this.muzzlePoint.name = 'MuzzleTip'
    this.muzzlePoint.position.set(0, 0.045, 1.18)
    this.turretElevationAxis.add(this.muzzlePoint)

    this.gunCamera = new GunCamera(this.scene, this.gunCameraMount, this)

    this.wheelMeshes = {
      frontLeft: findSingleNode(carScene, 'wheel_FL'),
      frontRight: findSingleNode(carScene, 'wheel_FR'),
      rearLeft: findSingleNode(carScene, 'wheel_RL'),
      rearRight: findSingleNode(carScene, 'wheel_RR'),
    }

    if (
      !this.chassis ||
      !this.wheelMeshes.frontLeft ||
      !this.wheelMeshes.frontRight ||
      !this.wheelMeshes.rearLeft ||
      !this.wheelMeshes.rearRight
    ) {
      throw new Error('Could not find all required truck parts (body, wheel_..., etc.) in GLTF.')
    }

    this.hitch = findSingleNode(carScene, 'hitch')
    if (this.hitch.parent !== this.chassis) {
      const local = this.hitch.position.clone()
      this.chassis.add(this.hitch)
      this.hitch.position.copy(local)
    }
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()) {
    this.chassis.updateMatrixWorld(true)
    if (this.muzzlePoint) {
      return this.muzzlePoint.getWorldPosition(target)
    }
    return this.bulletOrigin.getWorldPosition(target)
  }

  setupChassis(position) {
    this.chassis.position.copy(position)
    this.scene.add.existing(this.chassis)
    this.scene.add.existing(this.wheelMeshes.frontLeft)
    this.scene.add.existing(this.wheelMeshes.frontRight)
    this.scene.add.existing(this.wheelMeshes.rearLeft)
    this.scene.add.existing(this.wheelMeshes.rearRight)
  }

  setupPhysics() {
    this.physics.add.existing(this.chassis, {
      shape: 'convex',
      mass: 1200,
      collisionGroup: 1 | 2,
      collisionMask: 1 | 2,
    })
    this.chassis.body.setDamping(0.2, 0.2)

    if (!this.chassis.body || !this.chassis.body.ammo) {
      console.error('Chassis physics body not found. Add physics to chassis before creating Vehicle.')
      return false
    }
    return true
  }

  setupVehicle() {
    const { physicsWorld } = this.physics
    this.tuning = new Ammo.btVehicleTuning()
    const rayCaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld)
    this.vehicle = new Ammo.btRaycastVehicle(this.tuning, this.chassis.body.ammo, rayCaster)

    this.chassis.body.skipUpdate = true
    this.vehicle.setCoordinateSystem(0, 1, 2)
    physicsWorld.addAction(this.vehicle)

    this.addWheel(this.wheelMeshes.frontLeft, true, 0.5)
    this.addWheel(this.wheelMeshes.frontRight, true, 0.5)
    this.addWheel(this.wheelMeshes.rearLeft, false, 0.5)
    this.addWheel(this.wheelMeshes.rearRight, false, 0.5)
  }

  update() {
    let tm, p, q, i
    const n = this.vehicle.getNumWheels()
    const wheelArray = [
      this.wheelMeshes.frontLeft,
      this.wheelMeshes.frontRight,
      this.wheelMeshes.rearLeft,
      this.wheelMeshes.rearRight,
    ]

    for (i = 0; i < n; i++) {
      tm = this.vehicle.getWheelTransformWS(i)
      p = tm.getOrigin()
      q = tm.getRotation()
      if (wheelArray[i]) {
        wheelArray[i].position.set(p.x(), p.y(), p.z())
        wheelArray[i].quaternion.set(q.x(), q.y(), q.z(), q.w())
        wheelArray[i].rotateY(Math.PI)
      }
    }

    tm = this.vehicle.getChassisWorldTransform()
    p = tm.getOrigin()
    q = tm.getRotation()

    this.chassis.position.set(p.x(), p.y(), p.z())
    this.chassis.quaternion.set(q.x(), q.y(), q.z(), q.w())
  }

  addWheel(wheelMesh, isFront, radius) {
    const pos = new Ammo.btVector3(wheelMesh.position.x, wheelMesh.position.y, wheelMesh.position.z)

    const suspensionStiffness = 50.0
    const suspensionDampingRelaxation = 2.3
    const suspensionDampingCompression = 4.4
    const suspensionRestLength = 0.0
    const maxSuspensionTravelCm = 500

    this.tuning.set_m_maxSuspensionTravelCm(maxSuspensionTravelCm)

    const wheelDirectionCS0 = new Ammo.btVector3(0, -1, 0)
    const wheelAxleCS = new Ammo.btVector3(-1, 0, 0)

    const wheelInfo = this.vehicle.addWheel(
      pos,
      wheelDirectionCS0,
      wheelAxleCS,
      suspensionRestLength,
      radius,
      this.tuning,
      isFront
    )

    wheelInfo.set_m_suspensionStiffness(suspensionStiffness)
    wheelInfo.set_m_wheelsDampingRelaxation(suspensionDampingRelaxation)
    wheelInfo.set_m_wheelsDampingCompression(suspensionDampingCompression)
    wheelInfo.set_m_frictionSlip(1.5)
    wheelInfo.set_m_rollInfluence(0.5)
  }

  createMinimapSprite() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')

    ctx.clearRect(0, 0, 64, 64)
    ctx.fillStyle = '#ff0000'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2

    ctx.beginPath()
    ctx.moveTo(32, 8)
    ctx.lineTo(16, 48)
    ctx.lineTo(48, 48)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const planeGeometry = new THREE.PlaneGeometry(1, 1)
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
    })

    const SCALE = 60
    this.minimapSprite = new THREE.Mesh(planeGeometry, planeMaterial)
    this.minimapSprite.scale.set(SCALE, SCALE, 1)
    this.minimapSprite.layers.set(1)
    this.minimapSprite.position.set(0, 5, 0)
    this.minimapSprite.rotation.x = -Math.PI / 2
    this.minimapSprite.rotation.z = Math.PI

    this.chassis.add(this.minimapSprite)
  }
}

class VehicleTurret {
  turretVerticalAxis
  bulletOrigin
  raycaster = new THREE.Raycaster()
  mainScene = null
  vehicle = null
  lastShotTime = 0
  shootCooldownSec = 0.4
  isShooting = false

  turretYaw = 0
  gunPitch = 0.08
  targetYaw = 0
  targetPitch = 0.08
  barrelRecoilOffset = 0
  recoilKickDistance = 0.38
  recoilRecoverySpeed = 14

  constructor(turretVerticalAxis, bulletOrigin, vehicle) {
    this.turretVerticalAxis = turretVerticalAxis
    this.bulletOrigin = bulletOrigin
    this.vehicle = vehicle

    this.applyTransformsImmediate()

    window.pubsub.addEventListener('update', e => {
      this.mainScene = e.detail.mainScene
      const dt = Math.min(Math.max((e.detail.deltaTimeMs || 16) / 1000, 0.001), 0.1)
      this.update(e.detail.mainScene, e.detail.mouseCoords, dt)
    })

    document.addEventListener('mousedown', event => {
      if (event.defaultPrevented || isUiEvent(event) || !this.vehicle.scene.gameStarted) return
      if (event.button === 0) {
        this.isShooting = true
      }
    })

    document.addEventListener('mouseup', event => {
      if (event.button === 0) {
        this.isShooting = false
      }
    })

    window.addEventListener('blur', () => {
      this.isShooting = false
    })
  }

  triggerBarrelRecoil() {
    this.barrelRecoilOffset = -this.recoilKickDistance
    if (this.vehicle.turretElevationAxis) {
      this.vehicle.turretElevationAxis.position.set(0, 0, this.barrelRecoilOffset)
    }
  }

  setAimAngles(yaw, pitch, immediate = false) {
    this.targetYaw = yaw
    this.targetPitch = THREE.MathUtils.clamp(pitch, MIN_GUN_PITCH, MAX_GUN_PITCH)
    if (immediate) {
      this.turretYaw = this.targetYaw
      this.gunPitch = this.targetPitch
      this.applyTransformsImmediate()
    }
  }

  applyTransformsImmediate() {
    this.gunPitch = THREE.MathUtils.clamp(this.gunPitch, MIN_GUN_PITCH, MAX_GUN_PITCH)
    if (this.turretVerticalAxis) {
      this.turretVerticalAxis.rotation.set(0, this.turretYaw, 0)
    }
    if (this.vehicle.gunElevationPivot) {
      this.vehicle.gunElevationPivot.rotation.set(-this.gunPitch, 0, 0)
    }
    if (this.vehicle.turretElevationAxis) {
      this.vehicle.turretElevationAxis.position.set(0, 0, this.barrelRecoilOffset)
    }
  }

  applyAnglesAndRecoil(dt = 0.016) {
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch, MIN_GUN_PITCH, MAX_GUN_PITCH)

    const damp = 1 - Math.exp(-20 * dt)
    this.turretYaw = lerpAngle(this.turretYaw, this.targetYaw, damp)
    this.gunPitch = THREE.MathUtils.lerp(this.gunPitch, this.targetPitch, damp)
    this.gunPitch = THREE.MathUtils.clamp(this.gunPitch, MIN_GUN_PITCH, MAX_GUN_PITCH)

    if (this.barrelRecoilOffset < 0) {
      this.barrelRecoilOffset *= Math.exp(-this.recoilRecoverySpeed * dt)
      if (this.barrelRecoilOffset > -0.002) {
        this.barrelRecoilOffset = 0
      }
    }

    this.applyTransformsImmediate()
  }

  aimAtWorldPoint(worldPoint, immediate = false) {
    const baseParent = this.turretVerticalAxis?.parent
    if (!baseParent) return
    baseParent.updateWorldMatrix(true, false)
    const localPt = baseParent.worldToLocal(worldPoint.clone())
    localPt.y -= 0.47

    const yaw = Math.atan2(localPt.x, localPt.z)
    const horizDist = Math.hypot(localPt.x, localPt.z)
    const pitch = THREE.MathUtils.clamp(
      Math.atan2(localPt.y, Math.max(1.0, horizDist)),
      MIN_GUN_PITCH,
      MAX_GUN_PITCH
    )
    this.setAimAngles(yaw, pitch, immediate)
  }

  getBarrelWorldDirection(target = new THREE.Vector3()) {
    this.vehicle.gunElevationPivot.updateWorldMatrix(true, false)
    return target.set(0, 0, 1).transformDirection(this.vehicle.gunElevationPivot.matrixWorld).normalize()
  }

  aimTurret(mainScene, mouseCoords) {
    if (!mouseCoords || !mainScene || !mainScene.camera) return
    if (this.vehicle.gunCamera?.isActive) return

    this.raycaster.setFromCamera(mouseCoords, mainScene.camera)
    let targetPoint = null

    if (mainScene.terrain2?.mauiModel) {
      const intersects = this.raycaster.intersectObject(mainScene.terrain2.mauiModel, true)
      if (intersects.length > 0) {
        targetPoint = intersects[0].point.clone()
        targetPoint.y += 0.5
      }
    }

    if (!targetPoint) {
      targetPoint = new THREE.Vector3()
      this.raycaster.ray.at(95, targetPoint)
    }

    const muzzlePos = this.vehicle.getMuzzleWorldPosition(new THREE.Vector3())
    const horizDist = Math.hypot(targetPoint.x - muzzlePos.x, targetPoint.z - muzzlePos.z)
    const flightTime = Math.max(0.15, horizDist / 68)
    const gravityLead = 0.5 * 12.0 * flightTime * flightTime
    const ballisticTarget = targetPoint.clone()
    ballisticTarget.y += gravityLead

    this.aimAtWorldPoint(ballisticTarget, false)
  }

  shoot() {
    const currentTime = Date.now()
    if (currentTime - this.lastShotTime < this.shootCooldownSec * 1000) {
      return
    }
    if (!this.mainScene) return

    this.lastShotTime = currentTime
    this.triggerBarrelRecoil()

    const turretCenterPosition = new THREE.Vector3()
    this.turretVerticalAxis.getWorldPosition(turretCenterPosition)

    createMuzzleFlash(this.mainScene, this.vehicle.muzzlePoint || this.bulletOrigin, turretCenterPosition)
    playExplosionSound()

    new Bullet(this.mainScene, this.bulletOrigin)

    const directionForRecoil = this.getBarrelWorldDirection(new THREE.Vector3())
    const recoilMagnitude = 500
    const recoilImpulse = directionForRecoil.clone().multiplyScalar(-recoilMagnitude)
    const vehicleBody = this.vehicle.chassis.body.ammo

    const worldPos = this.vehicle.getMuzzleWorldPosition(new THREE.Vector3())
    const localPos = this.vehicle.chassis.worldToLocal(worldPos)
    const ammoLocalPos = new Ammo.btVector3(localPos.x, localPos.y, localPos.z)
    const ammoRecoil = new Ammo.btVector3(recoilImpulse.x, recoilImpulse.y, recoilImpulse.z)

    vehicleBody.applyImpulse(ammoRecoil, ammoLocalPos)
    vehicleBody.activate()
    Ammo.destroy(ammoLocalPos)
    Ammo.destroy(ammoRecoil)
  }

  update(mainScene, mouseCoords, dt = 0.016) {
    this.applyAnglesAndRecoil(dt)
    if (this.isShooting) {
      this.shoot()
    }
  }
}
