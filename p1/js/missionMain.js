import { Project, Scene3D, PhysicsLoader } from 'enable3d'
import * as THREE from 'three'
import { setupDatGUI, guiState } from './gui.js'
import { Vehicle } from './vehicle.js'
import { createGameHud } from './gameHud.js'
import { isUiEvent } from './gameInput.js'
import { snapYToTerrainInPlace, assetPath } from './util.js'
import { CameraManager } from './cameraManager.js'
import { Terrain2 } from './terrain2.js'
import { Minimap } from './minimap.js'
import { ProjectileEffects } from './projectileEffects.js'
import { playExplosionSound } from './sounds.js'
import {
  TEAM_COLORS,
  TOWER_TURRET_RANGE,
  FRIENDLY_CANNON_RING_RADIUS,
  SectorTower,
  FriendlyHeavyCannon,
  SiegeTrailer,
} from './conquestEntities.js'
import { MissionStartScene, getMissionDef } from './missionStartScene.js'
import { initAnalytics, trackEvent, trackMissionWin } from './analytics.js'

const MISSION_WEAPONS = {
  machineGun: {
    speed: 68,
    gravity: 12.0,
    lifetime: 3.5,
    radius: 0.9,
    damage: 25,
    splashRadius: 3.0,
    color: 0xffde95,
    isRocket: false,
  },
  machineGunRed: {
    speed: 52,
    gravity: 9.8,
    lifetime: 3.2,
    radius: 0.38,
    damage: 5,
    splashRadius: 0,
    color: 0xff3b3b,
    isRocket: false,
  },
  artillery: {
    speed: 56,
    gravity: 14.0,
    lifetime: 6.0,
    radius: 0.95,
    damage: 34,
    splashRadius: 11.5,
    color: 0xffae42,
    isRocket: true,
  },
}

function parseMissionFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const raw = Number(params.get('mission'))
  if (raw === 1 || raw === 2 || raw === 3) return raw
  return 1
}

class MissionScene extends Scene3D {
  car
  keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
  }
  vehicleSteering = 0
  light
  gltfCache = new Map()
  mouseCoords = new THREE.Vector3()
  aimRaycaster = new THREE.Raycaster()
  aimPoint = new THREE.Vector3()
  cameraManager = null
  terrain2
  minimap
  startMenu = null
  gameStarted = false
  missionComplete = false
  missionElapsedSec = 0
  shotsFired = 0
  currentMission = 1

  playerTeam = 'blue'
  playerHp = 100
  maxPlayerHp = 100
  towers = []
  trailers = []
  ammoTrailer = null
  friendlyCannon = null
  hitchCoupler = null
  projectiles = []
  roofGunCooldown = 0
  bannerTimer = 0
  pointerCameraPosition = new THREE.Vector3()
  pointerClipPosition = new THREE.Vector4()

  async preloadGltfs(paths) {
    const promises = paths.map(path =>
      this.load.gltf(assetPath(path)).then(gltf => {
        this.gltfCache.set(path, gltf)
        return gltf
      })
    )
    await Promise.all(promises)
  }

  getGltf(path) {
    return this.gltfCache.get(path) || null
  }

  async preload() {
    await this.preloadGltfs([
      '/assets/glb/turret3.glb',
      '/assets/glb/blockbench-truck.glb',
      '/assets/glb/Maui.glb',
      '/assets/glb/small-trailer.glb',
      '/assets/glb/trailer.glb',
      '/assets/glb/truck-wheel.glb',
    ])
  }

  async create() {
    window.pubsub = new EventTarget()
    window.missionScene = this
    this.currentMission = parseMissionFromUrl()
    initAnalytics('mission')

    const { lights } = await this.warpSpeed('light')
    this.createLargerSky()

    if (lights) {
      this.light = lights.directionalLight
      const d = 45
      this.light.shadow.camera.top = d
      this.light.shadow.camera.bottom = -d
      this.light.shadow.camera.left = -d
      this.light.shadow.camera.right = d
      this.light.shadow.mapSize.set(2048, 2048)
      this.light.shadow.camera.near = 100
      this.light.shadow.camera.far = 320
      this.light.shadow.bias = -0.005
    }

    this.camera.far = 5000
    this.camera.updateProjectionMatrix()

    this.effects = new ProjectileEffects(this.scene, 600)
    this.tracerGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6)
    this.tracerGeo.rotateX(Math.PI / 2)
    this.shellGeo = new THREE.ConeGeometry(0.28, 1.35, 8)
    this.shellGeo.rotateX(Math.PI / 2)

    this.createTerrain()
    this.setupBaseEntities()

    this.minimap = new Minimap(this, { worldSize: 500 })
    this.createVictoryOverlay()
    this.configureMission(this.currentMission, { updateUrl: true })

    this.gameHud = createGameHud({
      getHitchCoupler: () => this.hitchCoupler,
      onDropTrailer: () => this.dropActiveTrailer(),
      onSwitchCamera: () => this.cameraManager?.switchCameraMode(),
    })

    this.createObjectivePointer()
    this.setupHudControls()
    this.setupKeyboardAndMouse()
    await setupDatGUI(this.physics)

    this.openStartMenu(this.currentMission)
    this.renderHud()
  }

  setActiveCamera(camera) {
    if (!camera) return
    this.camera = camera
  }

  createTerrain() {
    this.terrain2 = new Terrain2(this, {
      mauiGltf: this.getGltf('/assets/glb/Maui.glb'),
      modelScale: 1.0,
      waveHeight: 0.5,
      waveFrequency: 2.0,
      waveSpeed: 1.0,
    })
  }

  setupBaseEntities() {
    const towerStop = this.terrain2.freightStops[0]
    this.targetTower = new SectorTower(this, towerStop, 0)
    this.targetTower.name = 'Valley Tower'
    this.towers = [this.targetTower]

    this.spawnPos = this.terrain2.spawnPos.clone()
    snapYToTerrainInPlace(this, this.spawnPos)
    this.spawnPos.y += 1.2

    const fromTowerToSpawn = new THREE.Vector3(
      this.spawnPos.x - this.targetTower.position.x,
      0,
      this.spawnPos.z - this.targetTower.position.z
    )
    const u = fromTowerToSpawn.clone().normalize()
    const perp = new THREE.Vector3(-u.z, 0, u.x)
    this.friendlyCannonPos = new THREE.Vector3(
      this.targetTower.position.x + u.x * 74 + perp.x * 6,
      0,
      this.targetTower.position.z + u.z * 74 + perp.z * 6
    )
    snapYToTerrainInPlace(this, this.friendlyCannonPos)

    this.car = new Vehicle(this, this.spawnPos.clone())
    this.car.turret.aimTurret = () => this.aimTurretAtMouse()
    this.car.turret.shoot = () => this.firePlayerCommand()
    this.orientTruckTowardTower()

    const badgeGeo = new THREE.ConeGeometry(0.85, 1.4, 4)
    this.playerBadgeMat = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[this.playerTeam],
    })
    this.playerBadge = new THREE.Mesh(badgeGeo, this.playerBadgeMat)
    this.playerBadge.position.set(0, 3.2, 0)
    this.playerBadge.rotation.x = Math.PI
    this.car.chassis.add(this.playerBadge)
  }

  cleanupMissionExtras() {
    if (this.hitchCoupler?.coupled) {
      this.hitchCoupler.dropTrailer()
    }
    this.hitchCoupler = null

    if (this.ammoTrailer) {
      this.ammoTrailer.dispose()
      this.ammoTrailer = null
    }
    this.trailers = []

    if (this.friendlyCannon) {
      this.friendlyCannon.dispose()
      this.friendlyCannon = null
    }
  }

  clearProjectiles() {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh)
      p.mesh.material.dispose()
    }
    this.projectiles = []
  }

  configureMission(missionId, { updateUrl = true } = {}) {
    const def = getMissionDef(missionId)
    this.currentMission = def.id
    document.title = `${def.code} · ${def.title}`

    if (updateUrl) {
      window.history.replaceState(null, '', `${window.location.pathname}?mission=${def.id}`)
    }

    this.hideVictoryOverlay()
    this.clearProjectiles()
    this.cleanupMissionExtras()

    this.missionComplete = false
    this.missionElapsedSec = 0
    this.shotsFired = 0
    this.playerHp = this.maxPlayerHp

    for (const key of Object.keys(this.keys)) this.keys[key] = false
    this.vehicleSteering = 0
    this.orientTruckTowardTower()

    this.targetTower.ownerTeam = 'red'
    this.targetTower.captureProgress = 0
    this.targetTower.capturingTeam = null

    if (def.id === 1) {
      this.targetTower.hasTurret = false
      this.targetTower.armoredAgainstLightGun = false
      this.targetTower.turretHp = 0
    } else if (def.id === 2) {
      this.targetTower.hasTurret = true
      this.targetTower.armoredAgainstLightGun = false
      this.targetTower.turretHp = 100
    } else {
      this.targetTower.hasTurret = true
      this.targetTower.armoredAgainstLightGun = true
      this.targetTower.turretHp = 100

      this.friendlyCannon = new FriendlyHeavyCannon(
        this,
        this.friendlyCannonPos,
        this.targetTower
      )

      const dirToTower = new THREE.Vector3(
        this.targetTower.position.x - this.spawnPos.x,
        0,
        this.targetTower.position.z - this.spawnPos.z
      ).normalize()
      const trailerPos = new THREE.Vector3(
        this.spawnPos.x - dirToTower.x * 6.8,
        0,
        this.spawnPos.z - dirToTower.z * 6.8
      )
      snapYToTerrainInPlace(this, trailerPos)
      trailerPos.y += 0.4

      this.ammoTrailer = new SiegeTrailer(this, {
        id: 'mission-ammo',
        type: 'ammo',
        ownerTeam: this.playerTeam,
        position: trailerPos,
      })
      this.orientTrailerTowardTower(this.ammoTrailer, trailerPos)
      this.trailers = [this.ammoTrailer]
      this.hitchCoupler = this.ammoTrailer.coupler
    }

    this.targetTower.refreshVisuals()
    this.updateVoronoiColors()
    this.aimTurretAtMouse()
    this.renderHud()
  }

  openStartMenu(missionId = this.currentMission) {
    if (this.startMenu) {
      this.startMenu.dispose()
      this.startMenu = null
    }

    this.gameStarted = false
    this.configureMission(missionId, { updateUrl: true })

    const spawn = this.spawnPos
    this.camera.position.set(spawn.x, 280, spawn.z + 0.01)
    this.camera.lookAt(spawn.x, spawn.y, spawn.z)

    this.startMenu = new MissionStartScene(
      this,
      {
        spawnPos: this.spawnPos,
        towerPos: this.targetTower.position,
        friendlyCannonPos: this.friendlyCannonPos,
        towerRange: TOWER_TURRET_RANGE,
        selectedMission: this.currentMission,
        onSelectMission: selectedId => {
          this.configureMission(selectedId, { updateUrl: true })
        },
      },
      chosenMission => {
        if (chosenMission && chosenMission !== this.currentMission) {
          this.configureMission(chosenMission, { updateUrl: true })
        }
        this.gameStarted = true
        this.startMenu = null
        if (!this.cameraManager) {
          this.cameraManager = new CameraManager(this, this.car, this.camera)
          this.cameraManager.switchCameraMode({ instant: true })
        } else {
          const activeCtrl = this.cameraManager.controllers[this.cameraManager.currentIndex]
          activeCtrl?.activate?.()
        }
        this.alignCameraBehindTruck()
        const def = getMissionDef(this.currentMission)
        this.showBanner(def.deployBanner, 5.0)
        this.renderHud()
      }
    )
  }

  orientTruckTowardTower() {
    const dx = this.targetTower.position.x - this.spawnPos.x
    const dz = this.targetTower.position.z - this.spawnPos.z
    const yaw = Math.atan2(dx, dz)
    this.teleportTruckTo(this.spawnPos, yaw)
    this.alignCameraBehindTruck()
  }

  alignCameraBehindTruck() {
    const followCtrl = this.cameraManager?.controllers?.[1]
    if (!followCtrl || !this.car?.chassis || !this.targetTower) return
    const dx = this.targetTower.position.x - this.car.chassis.position.x
    const dz = this.targetTower.position.z - this.car.chassis.position.z
    const yaw = Math.atan2(dx, dz)
    followCtrl.smoothTargetAngle = yaw
    followCtrl.selfRotationAngle = yaw
    followCtrl.selfHeight = this.car.chassis.position.y + followCtrl.height
    followCtrl.update(0.016)
    this.camera.updateMatrixWorld(true)
    this.aimTurretAtMouse()
  }

  teleportTruckTo(pos, yaw = 0) {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

    this.car.chassis.position.copy(pos)
    this.car.chassis.quaternion.copy(quat)

    const body = this.car.chassis.body.ammo
    const transform = new Ammo.btTransform()
    transform.setIdentity()
    transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z))
    transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w))
    body.setWorldTransform(transform)
    body.getMotionState().setWorldTransform(transform)
    const zero = new Ammo.btVector3(0, 0, 0)
    body.setLinearVelocity(zero)
    body.setAngularVelocity(zero)
    Ammo.destroy(transform)
    Ammo.destroy(zero)

    this.car.vehicle.resetSuspension()
    this.car.update()
  }

  orientTrailerTowardTower(siegeTrailer, pos) {
    const dx = this.targetTower.position.x - this.spawnPos.x
    const dz = this.targetTower.position.z - this.spawnPos.z
    const yaw = Math.atan2(dx, dz)
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    siegeTrailer.applyState({
      ownerTeam: this.playerTeam,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      qx: quat.x,
      qy: quat.y,
      qz: quat.z,
      qw: quat.w,
    })
  }

  aimTurretAtMouse() {
    if (!this.car?.turretTraverseAxis || !this.camera) return false

    const isGunnerView = this.cameraManager?.isGunCameraActive()
    if (isGunnerView) {
      const origin = this.car.getMuzzleWorldPosition(new THREE.Vector3())
      const barrelDir = this.car.turret.getBarrelWorldDirection(new THREE.Vector3())
      this.aimRaycaster.set(origin, barrelDir)

      let aimedAtTower = false
      if (this.targetTower && this.targetTower.hasTurret && this.targetTower.turretHp > 0) {
        const towerCenter = new THREE.Vector3(
          this.targetTower.position.x,
          this.targetTower.position.y + 2.6,
          this.targetTower.position.z
        )
        const toTower = towerCenter.clone().sub(origin)
        if (toTower.dot(barrelDir) > 0 && this.aimRaycaster.ray.distanceToPoint(towerCenter) <= 12.0) {
          this.aimPoint.copy(towerCenter)
          aimedAtTower = true
        }
      }

      if (!aimedAtTower) {
        this.aimRaycaster.ray.at(85, this.aimPoint)
      }
      return aimedAtTower
    }

    this.camera.updateMatrixWorld(true)
    this.aimRaycaster.setFromCamera(this.mouseCoords, this.camera)

    let aimedAtTower = false
    if (this.targetTower && this.targetTower.hasTurret && this.targetTower.turretHp > 0) {
      const towerCenter = new THREE.Vector3(
        this.targetTower.position.x,
        this.targetTower.position.y + 2.6,
        this.targetTower.position.z
      )
      const towerNdc = towerCenter.clone().project(this.camera)
      const ndcDist = Math.hypot(this.mouseCoords.x - towerNdc.x, this.mouseCoords.y - towerNdc.y)
      const rayDist = this.aimRaycaster.ray.distanceToPoint(towerCenter)
      if ((towerNdc.z < 1 && ndcDist <= 0.36) || rayDist <= 9.0) {
        this.aimPoint.copy(towerCenter)
        aimedAtTower = true
      }
    }

    if (!aimedAtTower && this.terrain2?.mauiModel) {
      const hits = this.aimRaycaster.intersectObject(this.terrain2.mauiModel, true)
      if (hits.length > 0) {
        this.aimPoint.copy(hits[0].point)
        this.aimPoint.y += 0.5
      } else {
        this.aimRaycaster.ray.at(95, this.aimPoint)
      }
    } else if (!aimedAtTower) {
      this.aimRaycaster.ray.at(95, this.aimPoint)
    }

    const muzzlePos = this.car.getMuzzleWorldPosition(new THREE.Vector3())
    const horizDist = Math.hypot(this.aimPoint.x - muzzlePos.x, this.aimPoint.z - muzzlePos.z)
    const cfg = MISSION_WEAPONS.machineGun
    const flightTime = Math.max(0.15, horizDist / cfg.speed)
    const ballisticTarget = this.aimPoint.clone()
    ballisticTarget.y += 0.5 * cfg.gravity * flightTime * flightTime

    this.car.turret.aimAtWorldPoint(ballisticTarget, false)
    this.car.turret.applyAnglesAndRecoil(0.016)
    return aimedAtTower
  }

  createVictoryOverlay() {
    this.victoryEl = document.createElement('div')
    this.victoryEl.id = 'mission-victory-overlay'
    this.victoryEl.hidden = true
    this.victoryEl.innerHTML = `
      <div class="victory-card">
        <div class="victory-title" id="victory-title">MISSION ACCOMPLISHED</div>
        <div class="victory-subtitle" id="victory-subtitle"></div>
        <div class="victory-actions">
          <button type="button" class="victory-btn primary" id="victory-next-btn"></button>
          <button type="button" class="victory-btn" id="victory-replay-btn">[ REPLAY MISSION ]</button>
        </div>
      </div>
    `
    document.body.appendChild(this.victoryEl)

    this.victoryEl.querySelector('#victory-next-btn').addEventListener('click', () => {
      const def = getMissionDef(this.currentMission)
      if (def.nextMissionUrl) {
        const targetHref = new URL('p1/conquest.html?island=island-1', new URL('../../', import.meta.url)).href
        window.location.assign(targetHref)
        return
      }
      this.openStartMenu(def.nextMissionId)
    })

    this.victoryEl.querySelector('#victory-replay-btn').addEventListener('click', () => {
      this.resetMission()
    })
  }

  showVictoryOverlay() {
    if (!this.victoryEl) return
    const def = getMissionDef(this.currentMission)
    this.victoryEl.querySelector('#victory-title').textContent = `${def.title} — COMPLETE!`
    this.victoryEl.querySelector('#victory-subtitle').textContent =
      def.id === 3
        ? `Sector captured in ${this.missionElapsedSec.toFixed(1)}s · Training complete! Ready to deploy to Island 1 (Persistent Multiplayer Conquest).`
        : `Sector captured in ${this.missionElapsedSec.toFixed(1)}s`
    this.victoryEl.querySelector('#victory-next-btn').textContent = `[ ${def.nextButtonLabel} ]`
    this.victoryEl.hidden = false
  }

  hideVictoryOverlay() {
    if (this.victoryEl) {
      this.victoryEl.hidden = true
    }
  }

  createObjectivePointer() {
    this.pointerEl = document.createElement('div')
    this.pointerEl.className = 'dropoff-pointer'
    this.pointerEl.innerHTML =
      '<span class="dropoff-pointer-arrow" aria-hidden="true"></span><span class="dropoff-pointer-label"></span>'
    document.body.appendChild(this.pointerEl)
  }

  getObjectiveTarget() {
    if (this.currentMission === 1) {
      return {
        pos: this.targetTower.position,
        label: 'Capture Flag Ring',
      }
    }

    if (this.currentMission === 2) {
      if (this.targetTower.turretHp > 0) {
        return {
          pos: this.targetTower.position,
          label: 'Shoot Enemy Turret',
        }
      }
      return {
        pos: this.targetTower.position,
        label: 'Capture Flag Ring',
      }
    }

    if (this.friendlyCannon && !this.friendlyCannon.ammoLoaded) {
      if (this.ammoTrailer && !this.ammoTrailer.isCoupled) {
        return {
          pos: this.ammoTrailer.chassis.position,
          label: 'Hitch Ammo Trailer',
        }
      }
      return {
        pos: this.friendlyCannon.position,
        label: 'Friendly Cannon Ring',
      }
    }

    if (this.targetTower.turretHp > 0) {
      return {
        pos: this.targetTower.position,
        label: 'Shelling Enemy Bunker',
      }
    }

    return {
      pos: this.targetTower.position,
      label: 'Capture Flag Ring',
    }
  }

  updateObjectivePointer() {
    if (!this.pointerEl) return
    if (!this.gameStarted || this.missionComplete) {
      this.pointerEl.hidden = true
      return
    }

    const { pos: targetPos, label: labelText } = this.getObjectiveTarget()

    const camera = this.camera
    camera.updateWorldMatrix(true, false)
    const point = this.pointerCameraPosition
      .set(targetPos.x, targetPos.y + 2, targetPos.z)
      .applyMatrix4(camera.matrixWorldInverse)
    const clip = this.pointerClipPosition.set(point.x, point.y, point.z, 1).applyMatrix4(camera.projectionMatrix)
    const visible =
      point.z < 0 &&
      clip.w > 0 &&
      Math.abs(clip.x) <= clip.w &&
      Math.abs(clip.y) <= clip.w &&
      Math.abs(clip.z) <= clip.w

    this.pointerEl.hidden = false
    const viewport = this.renderer.domElement.getBoundingClientRect()
    const halfWidth = viewport.width / 2
    const halfHeight = viewport.height / 2
    let dx = clip.x * halfWidth
    let dy = -clip.y * halfHeight
    if (Math.hypot(dx, dy) < 0.0001) {
      dx = 0
      dy = 1
    }
    const insetX = Math.max(1, halfWidth - 72)
    const insetY = Math.max(1, halfHeight - 42)
    const scale = Math.min(insetX / Math.abs(dx), insetY / Math.abs(dy))
    this.pointerEl.style.left = `${viewport.left + halfWidth + dx * scale}px`
    this.pointerEl.style.top = `${viewport.top + halfHeight + dy * scale}px`
    this.pointerEl.querySelector('.dropoff-pointer-arrow').style.transform = `rotate(${Math.atan2(
      dy,
      dx
    )}rad)`

    const distance = Math.round(
      Math.hypot(
        this.car.chassis.position.x - targetPos.x,
        this.car.chassis.position.z - targetPos.z
      )
    )
    if (visible) {
      this.pointerEl.style.left = `${viewport.left + halfWidth + (clip.x / clip.w) * halfWidth}px`
      this.pointerEl.style.top = `${viewport.top + halfHeight - (clip.y / clip.w) * halfHeight - 36}px`
      this.pointerEl.querySelector('.dropoff-pointer-arrow').style.transform = 'rotate(90deg)'
    }
    const labelEl = this.pointerEl.querySelector('.dropoff-pointer-label')
    const fullText = `${labelText} · ${distance}m`
    if (labelEl.textContent !== fullText) labelEl.textContent = fullText
  }

  dropActiveTrailer() {
    if (!this.hitchCoupler?.coupled || !this.ammoTrailer) return false
    this.hitchCoupler.dropTrailer()
    this.ammoTrailer.trailer.setParked(true)
    this.ammoTrailer.refreshBillboard()
    this.onTrailerStateChanged(this.ammoTrailer, 'deployed')
    return true
  }

  onTrailerStateChanged(siegeTrailer, newState) {
    if (newState === 'hitched') {
      trackEvent('m3_hitch')
      this.showBanner('AMMO TRAILER HITCHED! TOW INTO THE FRIENDLY CANNON GOLD RING')
    } else if (this.friendlyCannon && !this.friendlyCannon.ammoLoaded) {
      const dist = Math.round(
        Math.hypot(
          siegeTrailer.chassis.position.x - this.friendlyCannon.position.x,
          siegeTrailer.chassis.position.z - this.friendlyCannon.position.z
        )
      )
      if (dist <= FRIENDLY_CANNON_RING_RADIUS) {
        this.friendlyCannon.loadAmmo(siegeTrailer)
      } else {
        this.showBanner(
          `AMMO UNHOOKED ${dist}M FROM FRIENDLY CANNON — TOW INSIDE THE 10M GOLD RING!`
        )
      }
    }
    this.renderHud()
  }

  onAmmoDelivered() {
    trackEvent('m3_ammo_delivered')
  }

  onTowerCaptured(tower) {
    this.missionComplete = true
    trackMissionWin(this.currentMission, {
      elapsedSec: Number(this.missionElapsedSec.toFixed(1)),
      shotsFired: this.shotsFired,
    })
    this.updateVoronoiColors()
    this.showBanner(
      `MISSION ${this.currentMission} ACCOMPLISHED! ${tower.name.toUpperCase()} CONQUERED IN ${this.missionElapsedSec.toFixed(1)}S`,
      10
    )
    this.showVictoryOverlay()
    this.renderHud()
  }

  updateVoronoiColors() {
    if (!this.minimap || !this.minimap.voronoiMaterials) return
    const maxFlags = 20
    const flatColors = new Float32Array(maxFlags * 3)
    const color = new THREE.Color(
      this.targetTower.ownerTeam === 'blue' ? 0x4da6ff : 0xff4d4d
    )
    for (let i = 0; i < maxFlags; i++) {
      flatColors[i * 3] = color.r
      flatColors[i * 3 + 1] = color.g
      flatColors[i * 3 + 2] = color.b
    }
    for (const mat of this.minimap.voronoiMaterials) {
      mat.uniforms.flagColors.value = flatColors
      mat.uniforms.flagColors.needsUpdate = true
    }
    this.minimap.render()
  }

  fireBallistic(weaponType, origin, direction, team = this.playerTeam, aimedAtTower = false) {
    const config = MISSION_WEAPONS[weaponType] || MISSION_WEAPONS.machineGun
    const mat = new THREE.MeshBasicMaterial({ color: config.color, toneMapped: false })
    const mesh = new THREE.Mesh(config.isRocket ? this.shellGeo : this.tracerGeo, mat)
    mesh.position.copy(origin)
    const velocity =
      direction.lengthSq() > 4
        ? direction.clone()
        : direction.clone().normalize().multiplyScalar(config.speed)
    mesh.lookAt(origin.clone().add(velocity))
    this.scene.add(mesh)

    this.effects.flash(origin, config.isRocket)
    if (team === this.playerTeam) this.shotsFired++

    this.projectiles.push({
      weaponType,
      config,
      team,
      aimedAtTower,
      mesh,
      position: origin.clone(),
      previous: origin.clone(),
      velocity,
      age: 0,
      trailTimer: 0,
    })
  }

  firePlayerCommand() {
    if (!this.gameStarted || this.missionComplete) return
    if (this.roofGunCooldown <= 0 && this.car?.bulletOrigin) {
      this.roofGunCooldown = 0.22
      const aimedAtTower = this.aimTurretAtMouse()
      const origin = this.car.getMuzzleWorldPosition(new THREE.Vector3())
      this.car.turret.triggerBarrelRecoil()

      const cfg = MISSION_WEAPONS.machineGun
      const isGunnerView = this.cameraManager?.isGunCameraActive()
      const velocity = new THREE.Vector3()

      if (isGunnerView && !aimedAtTower) {
        const barrelDir = this.car.turret.getBarrelWorldDirection(new THREE.Vector3())
        velocity.copy(barrelDir).multiplyScalar(cfg.speed)
      } else {
        const dx = this.aimPoint.x - origin.x
        const dy = this.aimPoint.y - origin.y
        const dz = this.aimPoint.z - origin.z
        const horizDist = Math.hypot(dx, dz)
        const flightTime = Math.max(0.15, horizDist / cfg.speed)
        velocity.set(
          dx / flightTime,
          (dy + 0.5 * cfg.gravity * flightTime * flightTime) / flightTime,
          dz / flightTime
        )
      }

      playExplosionSound()
      trackEvent('shots_fired')
      this.fireBallistic('machineGun', origin, velocity, this.playerTeam, aimedAtTower)
    }
  }

  updateProjectiles(dt) {
    const ray = new THREE.Ray()
    const segDir = new THREE.Vector3()
    const hitPoint = new THREE.Vector3()
    const expandedBox = new THREE.Box3()
    const playerBox = new THREE.Box3()
    if (this.car?.chassis) {
      playerBox.setFromCenterAndSize(
        new THREE.Vector3(
          this.car.chassis.position.x,
          this.car.chassis.position.y + 1.2,
          this.car.chassis.position.z
        ),
        new THREE.Vector3(3.8, 3.0, 6.2)
      )
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.previous.copy(p.position)
      p.velocity.y -= p.config.gravity * dt
      p.position.addScaledVector(p.velocity, dt)
      p.age += dt

      p.mesh.position.copy(p.position)
      p.mesh.lookAt(p.position.clone().add(p.velocity))

      p.trailTimer += dt
      if (p.trailTimer >= 0.028) {
        p.trailTimer = 0
        if (p.config.isRocket) {
          this.effects.emit(p.position, { color: 0xffe099, size: 1.3, life: 0.1 })
          this.effects.emit(p.position, {
            color: 0xa59f90,
            smoke: true,
            size: 0.45,
            endSize: 2.1,
            life: 1.4,
            opacity: 0.34,
          })
        } else if (p.team === this.playerTeam) {
          this.effects.emit(p.position, { color: 0xffd27d, size: 0.42, life: 0.07 })
        }
      }

      const segLen = p.position.distanceTo(p.previous)
      segDir.subVectors(p.position, p.previous).normalize()
      ray.set(p.previous, segDir)

      let impacted = false
      let directHitTower = false
      let impactPos = p.position.clone()

      if (
        this.targetTower.ownerTeam !== p.team &&
        this.targetTower.hasTurret &&
        this.targetTower.turretHp > 0
      ) {
        expandedBox.copy(this.targetTower.hitBox).expandByScalar(p.config.radius)
        if (ray.intersectBox(expandedBox, hitPoint) && hitPoint.distanceTo(p.previous) <= segLen) {
          this.targetTower.takeDamage(p.config.damage, p.weaponType)
          impactPos.copy(hitPoint)
          impacted = true
          directHitTower = true
        }
      }

      if (!impacted && p.team !== this.playerTeam && this.car?.chassis) {
        expandedBox.copy(playerBox).expandByScalar(p.config.radius)
        if (ray.intersectBox(expandedBox, hitPoint) && hitPoint.distanceTo(p.previous) <= segLen) {
          this.damagePlayerTruck(p.config.damage)
          impactPos.copy(hitPoint)
          impacted = true
        }
      }

      if (!impacted && !p.aimedAtTower && p.weaponType !== 'machineGun') {
        const groundY = this.terrain2.getHeightAtPosition(p.position.x, p.position.z)
        if (p.position.y <= groundY + 0.15) {
          impactPos.set(p.position.x, groundY + 0.15, p.position.z)
          impacted = true
        }
      } else if (!impacted && !p.aimedAtTower && p.weaponType === 'machineGun' && p.age > 0.08) {
        const groundY = this.terrain2.getHeightAtPosition(p.position.x, p.position.z)
        if (p.position.y <= groundY - 0.1) {
          impactPos.set(p.position.x, groundY + 0.15, p.position.z)
          impacted = true
        }
      }

      if (impacted) {
        if (
          !directHitTower &&
          p.config.splashRadius > 0 &&
          this.targetTower.ownerTeam !== p.team &&
          this.targetTower.hasTurret &&
          this.targetTower.turretHp > 0 &&
          this.targetTower.position.distanceTo(impactPos) <= p.config.splashRadius
        ) {
          this.targetTower.takeDamage(p.config.damage, p.weaponType)
        }

        if (p.config.isRocket) {
          this.effects.impact2(impactPos)
        } else {
          this.effects.impact1(impactPos)
        }
      }

      if (impacted || p.age >= p.config.lifetime) {
        this.scene.remove(p.mesh)
        p.mesh.material.dispose()
        this.projectiles.splice(i, 1)
      }
    }
  }

  damagePlayerTruck(amount) {
    this.playerHp = Math.max(0, this.playerHp - amount)
    if (this.playerHp === 0) {
      playExplosionSound()
      this.effects.impact2(this.car.chassis.position)
      this.showBanner('TRUCK DESTROYED BY TURRET — RESPAWNING AT SPAWN POINT!')
      this.respawnAtSpawn()
    }
    this.renderHud()
  }

  respawnAtSpawn() {
    this.dropActiveTrailer()
    this.playerHp = this.maxPlayerHp
    this.orientTruckTowardTower()
    this.renderHud()
  }

  resetMission() {
    this.configureMission(this.currentMission, { updateUrl: false })
    const def = getMissionDef(this.currentMission)
    this.showBanner(def.deployBanner)
    this.renderHud()
  }

  showBanner(message, durationSec = 4.0) {
    const banner = document.getElementById('conquest-banner')
    if (!banner) return
    banner.textContent = message
    banner.hidden = false
    this.bannerTimer = durationSec
  }

  setupHudControls() {
    document
      .getElementById('cq-reset-island-btn')
      ?.addEventListener('click', () => this.resetMission())
    document
      .getElementById('cq-missions-btn')
      ?.addEventListener('click', () => this.openStartMenu(this.currentMission))
  }

  setupKeyboardAndMouse() {
    const keyEvent = (e, down) => {
      if (!this.gameStarted) return
      if (down && isUiEvent(e)) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault()

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.w = down
          break
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.a = down
          break
        case 'KeyS':
        case 'ArrowDown':
          this.keys.s = down
          break
        case 'KeyD':
        case 'ArrowRight':
          this.keys.d = down
          break
        case 'Space':
          this.keys.space = down
          break
        case 'KeyT':
          if (down && !e.repeat) {
            e.preventDefault()
            this.dropActiveTrailer()
          }
          break
        case 'KeyF':
          if (down && !e.repeat) {
            e.preventDefault()
            this.firePlayerCommand()
          }
          break
        case 'KeyR':
          if (down && !e.repeat) {
            e.preventDefault()
            this.respawnAtSpawn()
          }
          break
        case 'Tab':
          if (down) {
            e.preventDefault()
            document.getElementById('minimap-container')?.classList.toggle('maximized')
          }
          break
      }
    }

    document.addEventListener('keydown', e => keyEvent(e, true))
    document.addEventListener('keyup', e => keyEvent(e, false))
    window.addEventListener('blur', () => {
      for (const key of Object.keys(this.keys)) this.keys[key] = false
    })

    document.addEventListener('mousemove', event => {
      this.mouseCoords.x = (event.clientX / window.innerWidth) * 2 - 1
      this.mouseCoords.y = -(event.clientY / window.innerHeight) * 2 + 1
    })

    document.addEventListener('mousedown', event => {
      if (this.gameStarted && event.button === 0 && !isUiEvent(event)) {
        this.firePlayerCommand()
      }
    })
  }

  renderHud(activeCaptureState = null) {
    const $ = id => document.getElementById(id)
    const def = getMissionDef(this.currentMission)

    const missionTitleEl = $('cq-mission-title')
    if (missionTitleEl) {
      missionTitleEl.textContent = def.shortTitle
    }

    const distToTower = this.car?.chassis
      ? Math.round(this.car.chassis.position.distanceTo(this.targetTower.position))
      : 102

    const towerHpRatio = Math.max(0, Math.min(1, this.targetTower.turretHp / 100))
    const towerStatusEl = $('cq-sector-summary')
    if (towerStatusEl) {
      if (this.targetTower.ownerTeam === 'blue') {
        towerStatusEl.textContent = 'CAPTURED'
      } else if (this.targetTower.hasTurret && this.targetTower.turretHp > 0) {
        towerStatusEl.textContent = `TURRET ${Math.ceil(this.targetTower.turretHp)}% · ${distToTower}M`
      } else {
        towerStatusEl.textContent = `OPEN RING · ${distToTower}M`
      }
    }

    const barRed = $('cq-bar-red')
    const barBlue = $('cq-bar-blue')
    if (barRed && barBlue) {
      if (this.targetTower.ownerTeam === 'blue') {
        barRed.style.width = '0%'
        barBlue.style.width = '100%'
      } else if (this.targetTower.hasTurret && this.targetTower.turretHp > 0) {
        barRed.style.width = `${towerHpRatio * 100}%`
        barBlue.style.width = `${(1 - towerHpRatio) * 100}%`
      } else {
        const capPct = Math.round((this.targetTower.captureProgress || 0) * 100)
        barRed.style.width = `${100 - capPct}%`
        barBlue.style.width = `${capPct}%`
      }
    }

    const hpText = $('cq-truck-hp-text')
    const hpFill = $('cq-truck-hp-fill')
    if (hpText) hpText.textContent = `${Math.ceil(this.playerHp)} / ${this.maxPlayerHp} HP`
    if (hpFill) {
      const ratio = Math.max(0, Math.min(1, this.playerHp / this.maxPlayerHp))
      hpFill.style.width = `${ratio * 100}%`
      hpFill.style.background = ratio > 0.5 ? '#85e8a5' : ratio > 0.25 ? '#ffc65c' : '#ff5252'
    }

    const objStatus = $('cq-objective-status')
    const capBar = $('cq-capture-bar')
    const capFill = $('cq-capture-fill')

    if (objStatus) {
      if (this.missionComplete) {
        objStatus.textContent = `Sector captured in ${this.missionElapsedSec.toFixed(1)}s!`
        if (capBar) capBar.hidden = true
      } else if (activeCaptureState?.capturing) {
        objStatus.textContent = `Capturing Flag… ${Math.round(activeCaptureState.progress * 100)}% (Hold 3s)`
        if (capBar) capBar.hidden = false
        if (capFill) capFill.style.width = `${Math.round(activeCaptureState.progress * 100)}%`
      } else if (this.currentMission === 1) {
        objStatus.textContent = 'Drive into the green Flag ring & hold for 3s'
        if (capBar) capBar.hidden = true
      } else if (this.currentMission === 2) {
        if (this.targetTower.turretHp > 0) {
          objStatus.textContent = `1/2 Aim with Mouse & Left-Click Turret (${Math.ceil(this.targetTower.turretHp)}% HP)`
        } else {
          objStatus.textContent = '2/2 Turret Destroyed! Drive into green ring (3s)'
        }
        if (capBar) capBar.hidden = true
      } else {
        if (this.targetTower.turretHp <= 0) {
          objStatus.textContent = '4/4 Bunker Destroyed! Drive into green ring (3s)'
        } else if (this.friendlyCannon?.ammoLoaded) {
          objStatus.textContent = `3/4 Friendly Cannon shelling Bunker (${Math.ceil(this.targetTower.turretHp)}% HP)`
        } else if (this.ammoTrailer?.isCoupled) {
          objStatus.textContent = '2/4 Tow Ammo Trailer into Friendly Cannon gold ring'
        } else {
          objStatus.textContent = '1/4 Back up (S) to hitch Ammo Trailer at Spawn'
        }
        if (capBar) capBar.hidden = true
      }
    }

    const trailerBadge = $('cq-trailer-badge')
    if (trailerBadge) {
      if (this.currentMission === 1) {
        trailerBadge.textContent = '● Undefended Flag'
      } else if (this.currentMission === 2) {
        trailerBadge.textContent =
          this.targetTower.turretHp > 0 ? '● Roof Gun Active' : '● Turret Destroyed'
      } else if (this.friendlyCannon?.ammoLoaded) {
        trailerBadge.textContent = '● Cannon Shelling'
      } else if (this.ammoTrailer?.isCoupled) {
        trailerBadge.textContent = '● Hitched (Ammo)'
      } else {
        trailerBadge.textContent = '○ Ammo Unhitched'
      }
    }
  }

  update(time, deltaTime) {
    const dt = Math.min(Math.max((deltaTime || 16) / 1000, 0.001), 0.08)
    guiState.fps = 1 / dt
    this.roofGunCooldown = Math.max(0, this.roofGunCooldown - dt)

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt
      if (this.bannerTimer <= 0) {
        const banner = document.getElementById('conquest-banner')
        if (banner) banner.hidden = true
      }
    }

    if (this.light && this.car?.chassis) {
      this.light.position.x = this.car.chassis.position.x
      this.light.position.y = this.car.chassis.position.y + 180
      this.light.position.z = this.car.chassis.position.z + 90
      this.light.target = this.car.chassis
    }

    if (this.terrain2) {
      this.terrain2.updateWater(this.camera, time)
    }

    if (this.gameStarted && !this.missionComplete) {
      this.missionElapsedSec += dt
    }

    const FRONT_LEFT = 0
    const FRONT_RIGHT = 1
    const BACK_LEFT = 2
    const BACK_RIGHT = 3

    if (this.gameStarted) {
      let engineForce = 0
      let breakingForce = 0
      const steeringIncrement = 0.04
      const steeringClamp = 0.3
      const maxEngineForce = 5200
      const maxBreakingForce = 110

      if (this.keys.w) engineForce = maxEngineForce
      else if (this.keys.s) engineForce = -maxEngineForce

      if (this.keys.a) {
        if (this.vehicleSteering < steeringClamp) this.vehicleSteering += steeringIncrement
      } else if (this.keys.d) {
        if (this.vehicleSteering > -steeringClamp) this.vehicleSteering -= steeringIncrement
      } else {
        if (this.vehicleSteering > 0) this.vehicleSteering -= steeringIncrement / 2
        if (this.vehicleSteering < 0) this.vehicleSteering += steeringIncrement / 2
        if (Math.abs(this.vehicleSteering) <= steeringIncrement) this.vehicleSteering = 0
      }

      if (this.keys.space) breakingForce = maxBreakingForce

      this.car.vehicle.applyEngineForce(engineForce, BACK_LEFT)
      this.car.vehicle.applyEngineForce(engineForce, BACK_RIGHT)
      this.car.vehicle.setSteeringValue(this.vehicleSteering, FRONT_LEFT)
      this.car.vehicle.setSteeringValue(this.vehicleSteering, FRONT_RIGHT)
      this.car.vehicle.setBrake(breakingForce / 2, FRONT_LEFT)
      this.car.vehicle.setBrake(breakingForce / 2, FRONT_RIGHT)
      this.car.vehicle.setBrake(breakingForce, BACK_LEFT)
      this.car.vehicle.setBrake(breakingForce, BACK_RIGHT)
      this.car.update()
    }

    if (this.ammoTrailer) {
      const hitchWorld = new THREE.Vector3()
      const recvWorld = new THREE.Vector3()
      this.car.hitch.getWorldPosition(hitchWorld)
      this.ammoTrailer.trailer.hitchReceiver.getWorldPosition(recvWorld)
      const hitchDist = recvWorld.distanceTo(hitchWorld)

      if (!this.ammoTrailer.isCoupled && !this.ammoTrailer.delivered) {
        this.ammoTrailer.trailer.setParked(hitchDist >= this.ammoTrailer.coupler.attractRadius)
      }
      this.hitchCoupler = this.ammoTrailer.coupler
      this.ammoTrailer.update(dt, true)
    }

    if (this.friendlyCannon) {
      this.friendlyCannon.update(dt, this.ammoTrailer)
    }

    const playerPos = this.gameStarted ? this.car.chassis.position : null
    const captureState = this.targetTower.update(dt, playerPos, this.playerTeam)

    this.updateProjectiles(dt)
    this.effects.update(dt)

    if (this.gameStarted && this.cameraManager && !this.startMenu?.isTransitioning) {
      this.cameraManager.update(dt)
    }

    if (this.gameStarted) {
      this.aimTurretAtMouse()
    }

    window.pubsub.dispatchEvent(
      new CustomEvent('update', {
        detail: {
          timeSec: time,
          deltaTimeMs: dt * 1000,
          mainScene: this,
          mouseCoords: this.mouseCoords,
        },
      })
    )

    this.updateObjectivePointer()
    this.gameHud?.update()
    this.renderHud(captureState)
  }

  createLargerSky() {
    const existingSky = this.scene.children.find(
      child => child.name === 'sky' || child.material?.uniforms?.topColor
    )
    if (existingSky) {
      this.scene.remove(existingSky)
    }

    const skyGeometry = new THREE.SphereGeometry(2000, 32, 15)
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },
        bottomColor: { value: new THREE.Color('LightSkyBlue') },
        offset: { value: 33 },
        exponent: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    })

    const sky = new THREE.Mesh(skyGeometry, skyMaterial)
    sky.name = 'customSky'
    this.scene.add(sky)
  }
}

PhysicsLoader(assetPath('/lib/ammo/kripken'), () =>
  new Project({
    scenes: [MissionScene],
    antialias: true,
    gravity: new THREE.Vector3(0, -10, 0),
  })
)
