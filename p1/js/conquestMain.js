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
  SectorTower,
  SiegeTrailer,
  AiRaiderTruck,
} from './conquestEntities.js'
import { ConquestNet, RemoteTruck } from './conquestNet.js'

const CONQUEST_WEAPONS = {
  machineGun: {
    speed: 105,
    gravity: 1.2,
    lifetime: 2.4,
    radius: 0.3,
    damage: 14,
    splashRadius: 2.5,
    color: 0xffde95,
    isRocket: false,
  },
  machineGunRed: {
    speed: 58,
    gravity: 1.0,
    lifetime: 2.6,
    radius: 0.35,
    damage: 5,
    splashRadius: 0,
    color: 0xff3b3b,
    isRocket: false,
  },
  artillery: {
    speed: 62,
    gravity: 9.5,
    lifetime: 5.5,
    radius: 0.6,
    damage: 36,
    splashRadius: 10.5,
    color: 0xffae42,
    isRocket: true,
  },
}

class ConquestScene extends Scene3D {
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
  cameraManager
  terrain2
  minimap
  gameStarted = true

  playerTeam = 'red'
  playerHp = 100
  maxPlayerHp = 100
  towers = []
  trailers = []
  remoteTrucks = new Map()
  projectiles = []
  aiRaider = null
  net = null
  netBroadcastTimer = 0
  roofGunCooldown = 0
  bannerTimer = 0

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
    window.conquestScene = this

    const params = new URLSearchParams(window.location.search)
    const urlTeam = params.get('team')
    if (urlTeam === 'red' || urlTeam === 'blue') {
      this.playerTeam = urlTeam
    }

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

    this.camera.position.set(5, 18, -25)
    this.camera.lookAt(0, 0, 0)
    this.camera.far = 5000
    this.camera.updateProjectionMatrix()

    this.effects = new ProjectileEffects(this.scene, 600)
    this.tracerGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6)
    this.tracerGeo.rotateX(Math.PI / 2)
    this.shellGeo = new THREE.ConeGeometry(0.24, 1.2, 8)
    this.shellGeo.rotateX(Math.PI / 2)

    this.createTerrain()
    this.createTowers()

    const spawnPos = this.getTeamSpawnPosition(this.playerTeam)
    this.car = new Vehicle(this, spawnPos)
    this.decoratePlayerTruck()

    this.createInitialTrailers()
    this.aiRaider = new AiRaiderTruck(
      this,
      this.towers.map(t => t.position)
    )
    this.aiRaider.setEnemyOf(this.playerTeam)

    this.minimap = new Minimap(this, { worldSize: 500 })
    this.updateVoronoiColors()

    this.cameraManager = new CameraManager(this, this.car, this.camera)
    // Start in Follow Camera (index 1) for intuitive driving + towing
    this.cameraManager.switchCameraMode()

    this.gameHud = createGameHud({
      getHitchCoupler: () => this.hitchCoupler,
      onDropTrailer: () => this.dropActiveTrailer(),
      onSwitchCamera: () => this.cameraManager?.switchCameraMode(),
    })

    this.setupHudControls()
    this.setupKeyboardAndMouse()
    await setupDatGUI(this.physics)
    await this.setupNetworking(params)
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

  createTowers() {
    const stops = this.terrain2.freightStops
    this.towers = stops.map((stop, idx) => new SectorTower(this, stop, idx))
  }

  getTeamSpawnPosition(team) {
    const homeTower =
      this.towers.find(t => t.ownerTeam === team) ||
      (team === 'red' ? this.towers[0] : this.towers[this.towers.length - 1])
    if (homeTower) {
      const pos = new THREE.Vector3(homeTower.position.x + 12, 0, homeTower.position.z + 8)
      snapYToTerrainInPlace(this, pos)
      pos.y += 1.5
      return pos
    }
    const fallback = this.terrain2.spawnPos.clone()
    snapYToTerrainInPlace(this, fallback)
    fallback.y += 1.5
    return fallback
  }

  decoratePlayerTruck() {
    const badgeGeo = new THREE.ConeGeometry(0.85, 1.4, 4)
    this.playerBadgeMat = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[this.playerTeam],
    })
    this.playerBadge = new THREE.Mesh(badgeGeo, this.playerBadgeMat)
    this.playerBadge.position.set(0, 3.2, 0)
    this.playerBadge.rotation.x = Math.PI
    this.car.chassis.add(this.playerBadge)
  }

  findFlatBayNear(origin, radius = 14, angleOffset = 0) {
    let best = null
    for (let i = 0; i < 10; i++) {
      const angle = angleOffset + (i * Math.PI) / 5
      const x = origin.x + Math.cos(angle) * radius
      const z = origin.z + Math.sin(angle) * radius
      const y = this.terrain2.getHeightAtPosition(x, z)
      if (y <= this.terrain2.config.waterLevel + 0.4) continue
      const y2 = this.terrain2.getHeightAtPosition(x + 2, z + 2)
      const slope = Math.abs(y - y2)
      if (!best || slope < best.slope) {
        best = { x, y: y + 0.35, z, slope }
      }
    }
    return best || { x: origin.x + 8, y: origin.y + 0.5, z: origin.z }
  }

  createInitialTrailers() {
    const redHome = this.towers[0]?.position || this.terrain2.spawnPos
    const blueHome = this.towers[this.towers.length - 1]?.position || this.terrain2.spawnPos

    const bayRedArt = this.findFlatBayNear(redHome, 14, 0.2)
    const bayRedSen = this.findFlatBayNear(redHome, 16, 1.8)
    const bayBlueArt = this.findFlatBayNear(blueHome, 14, 0.5)
    const bayBlueSen = this.findFlatBayNear(blueHome, 16, 2.2)

    this.trailers.push(
      new SiegeTrailer(this, {
        id: 'artillery-1',
        type: 'artillery',
        ownerTeam: 'red',
        position: new THREE.Vector3(bayRedArt.x, bayRedArt.y, bayRedArt.z),
      }),
      new SiegeTrailer(this, {
        id: 'sentry-1',
        type: 'sentry',
        ownerTeam: 'red',
        position: new THREE.Vector3(bayRedSen.x, bayRedSen.y, bayRedSen.z),
      }),
      new SiegeTrailer(this, {
        id: 'artillery-2',
        type: 'artillery',
        ownerTeam: 'blue',
        position: new THREE.Vector3(bayBlueArt.x, bayBlueArt.y, bayBlueArt.z),
      }),
      new SiegeTrailer(this, {
        id: 'sentry-2',
        type: 'sentry',
        ownerTeam: 'blue',
        position: new THREE.Vector3(bayBlueSen.x, bayBlueSen.y, bayBlueSen.z),
      })
    )
  }

  spawnOrSummonTrailer(type) {
    // Find an uncoupled trailer of this type or create a new one right behind the player's truck
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.chassis.quaternion)
    const spawnX = this.car.chassis.position.x - forward.x * 8.5
    const spawnZ = this.car.chassis.position.z - forward.z * 8.5
    const spawnY = this.terrain2.getHeightAtPosition(spawnX, spawnZ) + 0.45

    let trailer = this.trailers.find(t => t.type === type && !t.isCoupled)
    if (trailer) {
      trailer.ownerTeam = this.playerTeam
      trailer.applyState({
        ownerTeam: this.playerTeam,
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        qx: this.car.chassis.quaternion.x,
        qy: this.car.chassis.quaternion.y,
        qz: this.car.chassis.quaternion.z,
        qw: this.car.chassis.quaternion.w,
      })
    } else {
      trailer = new SiegeTrailer(this, {
        id: `${type}-${this.trailers.length + 1}`,
        type,
        ownerTeam: this.playerTeam,
        position: new THREE.Vector3(spawnX, spawnY, spawnZ),
      })
      this.trailers.push(trailer)
    }

    this.showBanner(
      `${type === 'artillery' ? '120MM ARTILLERY' : 'AUTO-SENTRY'} TRAILER SPAWNED BEHIND TRUCK — BACK UP TO HITCH`
    )
    this.syncIslandToNetwork()
    this.renderHud()
    return trailer
  }

  dropActiveTrailer() {
    if (!this.hitchCoupler?.coupled) return false
    const activeTrailer = this.trailers.find(t => t.coupler === this.hitchCoupler)
    this.hitchCoupler.dropTrailer()
    if (activeTrailer) {
      activeTrailer.trailer.setParked(true)
      activeTrailer.refreshBillboard()
      this.onTrailerStateChanged(activeTrailer, 'deployed')
    }
    return true
  }

  onTrailerStateChanged(siegeTrailer, newState) {
    if (newState === 'hitched') {
      this.showBanner(
        `HITCHED ${siegeTrailer.type.toUpperCase()} TRAILER · HAUL TO RIDGE & PRESS T TO DEPLOY`
      )
    } else {
      const nearestTower = siegeTrailer.findNearestHostileTower()
      const msg = nearestTower
        ? `${siegeTrailer.type.toUpperCase()} DEPLOYED! TARGETING ${nearestTower.name.toUpperCase()}`
        : `${siegeTrailer.type.toUpperCase()} EMPLACEMENT DEPLOYED`
      this.showBanner(msg)
    }
    this.syncIslandToNetwork()
    this.renderHud()
  }

  onTowerCaptured(tower) {
    this.updateVoronoiColors()
    this.showBanner(
      `SECTOR CAPTURED! ${tower.name.toUpperCase()} IS NOW ${tower.ownerTeam.toUpperCase()} TERRITORY`
    )
    this.syncIslandToNetwork()
    this.renderHud()
  }

  updateVoronoiColors() {
    if (!this.minimap || !this.minimap.voronoiMaterials) return
    const maxFlags = 20
    const flatColors = new Float32Array(maxFlags * 3)

    this.towers.forEach((tower, i) => {
      if (i >= maxFlags) return
      const color = new THREE.Color(TEAM_COLORS[tower.ownerTeam] || TEAM_COLORS.neutral)
      flatColors[i * 3] = color.r
      flatColors[i * 3 + 1] = color.g
      flatColors[i * 3 + 2] = color.b
    })

    for (const mat of this.minimap.voronoiMaterials) {
      mat.uniforms.flagColors.value = flatColors
      mat.uniforms.flagColors.needsUpdate = true
    }
    this.minimap.render()
  }

  fireBallistic(weaponType, origin, direction, team = this.playerTeam, broadcast = true) {
    const config = CONQUEST_WEAPONS[weaponType] || CONQUEST_WEAPONS.machineGun
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

    this.projectiles.push({
      weaponType,
      config,
      team,
      mesh,
      position: origin.clone(),
      previous: origin.clone(),
      velocity,
      age: 0,
      trailTimer: 0,
    })

    if (broadcast && this.net) {
      this.net.publishShot({
        weaponType,
        team,
        origin: [origin.x, origin.y, origin.z],
        dir: [direction.x, direction.y, direction.z],
      })
    }
  }

  firePlayerCommand() {
    // 1. Fire truck roof gun in the direction of the turret
    if (this.roofGunCooldown <= 0 && this.car?.bulletOrigin) {
      this.roofGunCooldown = 0.22
      const origin = new THREE.Vector3()
      const dir = new THREE.Vector3()
      this.car.bulletOrigin.getWorldPosition(origin)
      this.car.bulletOrigin.getWorldDirection(dir)
      this.fireBallistic('machineGun', origin, dir, this.playerTeam, true)
    }

    // 2. Also trigger any deployed friendly Artillery Trailer to fire a siege round
    const deployedArtillery = this.trailers.filter(
      t => t.type === 'artillery' && t.isDeployed && t.ownerTeam === this.playerTeam
    )
    for (const art of deployedArtillery) {
      art.fireManualOrTarget()
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
      if (p.trailTimer >= 0.03) {
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
        }
      }

      const segLen = p.position.distanceTo(p.previous)
      segDir.subVectors(p.position, p.previous).normalize()
      ray.set(p.previous, segDir)

      let impacted = false
      let impactPos = p.position.clone()

      // Check direct hit against hostile Sector Towers
      for (const tower of this.towers) {
        if (tower.ownerTeam === p.team || tower.turretHp <= 0) continue
        expandedBox.copy(tower.hitBox).expandByScalar(p.config.radius)
        if (ray.intersectBox(expandedBox, hitPoint) && hitPoint.distanceTo(p.previous) <= segLen) {
          tower.takeDamage(p.config.damage)
          impactPos.copy(hitPoint)
          impacted = true
          this.syncIslandToNetwork()
          break
        }
      }

      // Check direct hit against AI raider truck
      if (!impacted && this.aiRaider?.alive && this.aiRaider.team !== p.team) {
        expandedBox.copy(this.aiRaider.hitBox).expandByScalar(p.config.radius)
        if (ray.intersectBox(expandedBox, hitPoint) && hitPoint.distanceTo(p.previous) <= segLen) {
          this.aiRaider.takeDamage(p.config.damage)
          impactPos.copy(hitPoint)
          impacted = true
        }
      }

      // Check hit against local player truck
      if (!impacted && p.team !== this.playerTeam && this.car?.chassis) {
        expandedBox.copy(playerBox).expandByScalar(p.config.radius)
        if (ray.intersectBox(expandedBox, hitPoint) && hitPoint.distanceTo(p.previous) <= segLen) {
          this.damagePlayerTruck(p.config.damage)
          impactPos.copy(hitPoint)
          impacted = true
        }
      }

      // Check terrain impact
      if (!impacted) {
        const groundY = this.terrain2.getHeightAtPosition(p.position.x, p.position.z)
        if (p.position.y <= groundY + 0.15) {
          impactPos.set(p.position.x, groundY + 0.15, p.position.z)
          impacted = true
        }
      }

      if (impacted) {
        if (p.config.splashRadius > 0) {
          let towerChanged = false
          for (const tower of this.towers) {
            if (tower.ownerTeam === p.team || tower.turretHp <= 0) continue
            if (tower.position.distanceTo(impactPos) <= p.config.splashRadius) {
              tower.takeDamage(p.config.damage)
              towerChanged = true
            }
          }
          if (towerChanged) this.syncIslandToNetwork()

          if (
            this.aiRaider?.alive &&
            this.aiRaider.team !== p.team &&
            this.aiRaider.position.distanceTo(impactPos) <= p.config.splashRadius
          ) {
            this.aiRaider.takeDamage(p.config.damage)
          }
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
      this.showBanner('TRUCK DESTROYED BY TURRET FIRE — RESPAWNING AT FRIENDLY SECTOR')
      this.respawnPlayerTruck()
    }
    this.renderHud()
  }

  respawnPlayerTruck(targetTower = null) {
    this.dropActiveTrailer()
    this.playerHp = this.maxPlayerHp
    const destPos = targetTower
      ? new THREE.Vector3(targetTower.position.x + 12, 0, targetTower.position.z + 8)
      : this.getTeamSpawnPosition(this.playerTeam)
    snapYToTerrainInPlace(this, destPos)
    destPos.y += 1.6

    const body = this.car.chassis.body.ammo
    const transform = new Ammo.btTransform()
    transform.setIdentity()
    transform.setOrigin(new Ammo.btVector3(destPos.x, destPos.y, destPos.z))
    body.setWorldTransform(transform)
    body.getMotionState().setWorldTransform(transform)
    const zero = new Ammo.btVector3(0, 0, 0)
    body.setLinearVelocity(zero)
    body.setAngularVelocity(zero)
    Ammo.destroy(transform)
    Ammo.destroy(zero)

    this.car.vehicle.resetSuspension()
    this.car.update()
    this.renderHud()
  }

  switchTeam(newTeam) {
    if (newTeam !== 'red' && newTeam !== 'blue') return
    this.playerTeam = newTeam
    if (this.playerBadgeMat) {
      this.playerBadgeMat.color.setHex(TEAM_COLORS[this.playerTeam])
    }
    if (this.aiRaider) {
      this.aiRaider.setEnemyOf(this.playerTeam)
    }
    this.showBanner(`SWITCHED TO ${this.playerTeam.toUpperCase()} FACTION`)
    this.renderHud()
  }

  serializeIslandState() {
    return {
      towers: this.towers.map(t => t.serialize()),
      trailers: this.trailers.map(t => t.serialize()),
    }
  }

  applyIslandState(state) {
    if (!state) return
    let ownerChanged = false
    if (Array.isArray(state.towers)) {
      for (const tState of state.towers) {
        const tower = this.towers.find(t => t.id === tState.id)
        if (tower && tower.applyState(tState)) {
          ownerChanged = true
        }
      }
    }
    if (Array.isArray(state.trailers)) {
      for (const trState of state.trailers) {
        const existing = this.trailers.find(t => t.id === trState.id)
        if (existing) {
          existing.applyState(trState)
        }
      }
    }
    if (ownerChanged) {
      this.updateVoronoiColors()
    }
    this.renderHud()
  }

  syncIslandToNetwork() {
    if (!this.net) return
    this.net.publishIslandState(this.serializeIslandState())
  }

  resetIslandDefault() {
    this.dropActiveTrailer()
    this.towers.forEach((tower, idx) => {
      tower.ownerTeam = idx < 3 ? 'red' : idx >= 5 ? 'blue' : 'neutral'
      tower.turretHp = 100
      tower.captureProgress = 0
      tower.refreshVisuals()
    })
    this.updateVoronoiColors()
    this.syncIslandToNetwork()
    this.showBanner('ISLAND RESET TO INITIAL FRONT LINE (3 RED · 2 NEUTRAL · 3 BLUE)')
    this.renderHud()
  }

  async setupNetworking(params) {
    const islandId = params.get('island') || 'maui_main'
    this.net = new ConquestNet(this, { islandId })

    this.net.on('island-state', state => {
      this.applyIslandState(state)
    })

    this.net.on('remote-truck', ({ peerId, state }) => {
      let remoteTruck = this.remoteTrucks.get(peerId)
      if (!remoteTruck) {
        remoteTruck = new RemoteTruck(this, peerId, state)
        this.remoteTrucks.set(peerId, remoteTruck)
      } else {
        remoteTruck.applyNetworkState(state)
      }
      this.updateNetworkHud()
    })

    this.net.on('peer-left', peerId => {
      const remoteTruck = this.remoteTrucks.get(peerId)
      if (remoteTruck) {
        remoteTruck.dispose()
        this.remoteTrucks.delete(peerId)
      }
      this.updateNetworkHud()
    })

    this.net.on('remote-shot', shot => {
      if (!shot || !shot.origin || !shot.dir) return
      this.fireBallistic(
        shot.weaponType,
        new THREE.Vector3(...shot.origin),
        new THREE.Vector3(...shot.dir),
        shot.team,
        false
      )
    })

    this.net.on('status', () => {
      this.updateNetworkHud()
    })

    await this.net.init(this.serializeIslandState())
    this.updateNetworkHud()
  }

  updateNetworkHud() {
    const statusEl = document.getElementById('cq-net-status')
    const peerEl = document.getElementById('cq-peer-count')
    if (statusEl && this.net) statusEl.textContent = this.net.statusText
    if (peerEl && this.net) {
      const count = this.net.getActivePeerCount()
      peerEl.textContent = `${count} online`
    }
  }

  showBanner(message, durationSec = 4.0) {
    const banner = document.getElementById('conquest-banner')
    if (!banner) return
    banner.textContent = message
    banner.hidden = false
    this.bannerTimer = durationSec
  }

  setupHudControls() {
    const $ = id => document.getElementById(id)

    $('cq-team-red')?.addEventListener('click', () => this.switchTeam('red'))
    $('cq-team-blue')?.addEventListener('click', () => this.switchTeam('blue'))
    $('cq-spawn-artillery-btn')?.addEventListener('click', () => this.spawnOrSummonTrailer('artillery'))
    $('cq-spawn-sentry-btn')?.addEventListener('click', () => this.spawnOrSummonTrailer('sentry'))
    $('cq-reset-island-btn')?.addEventListener('click', () => this.resetIslandDefault())

    $('cq-copy-invite-btn')?.addEventListener('click', () => {
      const url = this.net ? this.net.getInviteUrl() : window.location.href
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url)
      }
      this.showBanner('INVITE LINK COPIED')
    })
  }

  setupKeyboardAndMouse() {
    const keyEvent = (e, down) => {
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
            this.respawnPlayerTruck()
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
      if (event.button === 0 && !isUiEvent(event)) {
        this.firePlayerCommand()
      }
    })
  }

  renderHud(activeCaptureState = null) {
    const $ = id => document.getElementById(id)

    $('cq-team-red')?.classList.toggle('active', this.playerTeam === 'red')
    $('cq-team-blue')?.classList.toggle('active', this.playerTeam === 'blue')

    const total = this.towers.length || 1
    const redCount = this.towers.filter(t => t.ownerTeam === 'red').length
    const blueCount = this.towers.filter(t => t.ownerTeam === 'blue').length
    const neutralCount = total - redCount - blueCount

    const summaryEl = $('cq-sector-summary')
    if (summaryEl) summaryEl.textContent = `${redCount} · ${neutralCount} · ${blueCount}`

    const barRed = $('cq-bar-red')
    const barNeutral = $('cq-bar-neutral')
    const barBlue = $('cq-bar-blue')
    if (barRed) barRed.style.width = `${(redCount / total) * 100}%`
    if (barNeutral) barNeutral.style.width = `${(neutralCount / total) * 100}%`
    if (barBlue) barBlue.style.width = `${(blueCount / total) * 100}%`

    const hpFill = $('cq-truck-hp-fill')
    if (hpFill) {
      const ratio = Math.max(0, Math.min(1, this.playerHp / this.maxPlayerHp))
      hpFill.style.width = `${ratio * 100}%`
      hpFill.style.background = ratio > 0.5 ? '#85e8a5' : ratio > 0.25 ? '#ffc65c' : '#ff5252'
    }

    const objStatus = $('cq-objective-status')
    const capBar = $('cq-capture-bar')
    const capFill = $('cq-capture-fill')

    if (objStatus) {
      if (redCount === total || blueCount === total) {
        const winner = redCount === total ? 'RED' : 'BLUE'
        objStatus.textContent = `${winner} wins`
        if (capBar) capBar.hidden = true
      } else if (activeCaptureState?.shielded) {
        objStatus.textContent = 'Shielded: destroy the turret first'
        if (capBar) capBar.hidden = true
      } else if (activeCaptureState?.capturing) {
        objStatus.textContent = 'Capturing…'
        if (capBar) capBar.hidden = false
        if (capFill) capFill.style.width = `${Math.round(activeCaptureState.progress * 100)}%`
      } else {
        const openTower = this.towers.find(t => t.ownerTeam !== this.playerTeam && t.turretHp <= 0)
        objStatus.textContent = openTower ? `${openTower.name} is open: capture it` : ''
        if (capBar) capBar.hidden = true
      }
    }

    const coupledTrailer = this.trailers.find(t => t.isCoupled)
    const trailerBadge = $('cq-trailer-badge')
    if (trailerBadge) {
      trailerBadge.textContent = coupledTrailer ? `Towing ${coupledTrailer.type}` : 'No trailer'
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

    const FRONT_LEFT = 0
    const FRONT_RIGHT = 1
    const BACK_LEFT = 2
    const BACK_RIGHT = 3

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

    // Determine nearest candidate trailer for HitchCoupler
    const hitchWorld = new THREE.Vector3()
    const recvWorld = new THREE.Vector3()
    this.car.hitch.getWorldPosition(hitchWorld)

    let activeCandidate = this.trailers.find(t => t.isCoupled) || null
    let nearestDist = Infinity
    if (!activeCandidate) {
      for (const tr of this.trailers) {
        tr.trailer.hitchReceiver.getWorldPosition(recvWorld)
        const d = recvWorld.distanceTo(hitchWorld)
        if (d < nearestDist) {
          nearestDist = d
          activeCandidate = tr
        }
      }
      for (const tr of this.trailers) {
        if (!tr.isCoupled) {
          tr.trailer.setParked(tr !== activeCandidate || nearestDist >= tr.coupler.attractRadius)
        }
      }
    }

    this.hitchCoupler = activeCandidate?.coupler || null
    for (const tr of this.trailers) {
      tr.update(dt, tr === activeCandidate)
    }

    // Update Sector Towers and check capture status
    const playerPos = this.car.chassis.position
    let captureState = null
    for (const tower of this.towers) {
      const res = tower.update(dt, playerPos, this.playerTeam)
      if (res.inRing) captureState = res
    }

    if (this.aiRaider) {
      this.aiRaider.update(dt, playerPos)
    }

    this.updateProjectiles(dt)
    this.effects.update(dt)

    for (const remoteTruck of this.remoteTrucks.values()) {
      remoteTruck.update(dt)
    }

    // Broadcast local truck transform at ~12 Hz
    this.netBroadcastTimer -= dt
    if (this.net && this.netBroadcastTimer <= 0) {
      this.netBroadcastTimer = 0.085
      this.net.publishTruckState({
        team: this.playerTeam,
        x: Number(playerPos.x.toFixed(2)),
        y: Number(playerPos.y.toFixed(2)),
        z: Number(playerPos.z.toFixed(2)),
        qx: Number(this.car.chassis.quaternion.x.toFixed(3)),
        qy: Number(this.car.chassis.quaternion.y.toFixed(3)),
        qz: Number(this.car.chassis.quaternion.z.toFixed(3)),
        qw: Number(this.car.chassis.quaternion.w.toFixed(3)),
      })
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

    this.cameraManager?.update(dt)
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
    scenes: [ConquestScene],
    antialias: true,
    gravity: new THREE.Vector3(0, -10, 0),
  })
)
