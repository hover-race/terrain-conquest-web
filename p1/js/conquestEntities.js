import * as THREE from 'three'
import { Trailer } from './trailer.js'
import { HitchCoupler } from './hitchCoupler.js'
import { playExplosionSound, playFlagCaptureSound } from './sounds.js'

export const TEAM_COLORS = {
  red: 0xff4d4d,
  blue: 0x4da6ff,
  neutral: 0xffc65c,
}

export const TEAM_CSS = {
  red: '#ff5252',
  blue: '#4da6ff',
  neutral: '#ffc65c',
}

export const TOWER_CAPTURE_RADIUS = 10
export const TOWER_CAPTURE_SECONDS = 3.0
export const TOWER_TURRET_RANGE = 58
export const ARTILLERY_RANGE = 135
export const SENTRY_RANGE = 60
export const FRIENDLY_CANNON_RING_RADIUS = 10

const SECTOR_NAMES = [
  'North Ridge',
  'Crater Pass',
  'West Bay',
  'Summit Watch',
  'Canyon Gate',
  'South Harbor',
  'East Bluff',
  'Lava Point',
]

export class SectorTower {
  constructor(scene, stopData, index) {
    this.scene = scene
    this.id = stopData.id
    this.index = index
    this.name = SECTOR_NAMES[index] || `Sector ${index + 1}`
    this.position = new THREE.Vector3(stopData.x, stopData.y, stopData.z)

    this.ownerTeam = index < 3 ? 'red' : index >= 5 ? 'blue' : 'neutral'
    this.hasTurret = true
    this.armoredAgainstLightGun = false
    this.turretHp = 100
    this.maxTurretHp = 100
    this.captureProgress = 0
    this.capturingTeam = null
    this.fireCooldown = 0.6 + (index % 3) * 0.25
    this.smokeTimer = 0
    this.rebuildTimer = 0
    this.hitFlashTimer = 0

    this.group = new THREE.Group()
    this.group.name = `Tower-${this.id}`
    this.group.position.copy(this.position)
    this.scene.scene.add(this.group)

    this.hitBox = new THREE.Box3()
    this.muzzleWorld = new THREE.Vector3()
    this.aimDir = new THREE.Vector3()

    this.buildVisuals()
    this.buildMinimapMarker()
    this.updateHitBox()
    this.refreshVisuals()
  }

  buildVisuals() {
    const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x2c3539, roughness: 0.8, metalness: 0.3 })
    this.armorMat = new THREE.MeshStandardMaterial({ color: 0x4a5559, roughness: 0.6, metalness: 0.5 })
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1d2326, roughness: 0.5, metalness: 0.7 })
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd0d7de, roughness: 0.4, metalness: 0.8 })

    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.1, 2.6, 8), pedestalMat)
    base.position.y = 1.3
    base.castShadow = true
    base.receiveShadow = true
    base.userData.isTarget = true
    base.userData.class = this
    this.baseMesh = base
    this.group.add(base)

    this.teamBand = new THREE.Mesh(
      new THREE.CylinderGeometry(2.55, 2.55, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: TEAM_COLORS[this.ownerTeam], roughness: 0.4 })
    )
    this.teamBand.position.y = 2.2
    this.group.add(this.teamBand)

    this.flagGroup = new THREE.Group()
    this.flagGroup.position.set(-1.6, 2.5, -1.2)
    this.group.add(this.flagGroup)

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8), poleMat)
    pole.position.y = 2.6
    pole.castShadow = true
    this.flagGroup.add(pole)

    this.flagClothMat = new THREE.MeshStandardMaterial({
      color: TEAM_COLORS[this.ownerTeam],
      roughness: 0.5,
      side: THREE.DoubleSide,
    })
    this.flagCloth = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), this.flagClothMat)
    this.flagCloth.position.set(1.1, 4.4, 0)
    this.flagCloth.castShadow = true
    this.flagGroup.add(this.flagCloth)

    this.turretHead = new THREE.Group()
    this.turretHead.position.y = 2.9
    this.group.add(this.turretHead)

    const turretGltf = this.scene.getGltf('/assets/glb/turret3.glb')
    if (turretGltf) {
      const cloned = turretGltf.scene.clone(true)
      cloned.scale.setScalar(0.9)
      this.turretHead.add(cloned)
    }

    const dome = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 2.2), this.armorMat)
    dome.position.y = 0.4
    dome.castShadow = true
    dome.userData.isTarget = true
    dome.userData.class = this
    this.domeMesh = dome
    this.turretHead.add(dome)

    for (const side of [-0.45, 0.45]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.6, 8), barrelMat)
      barrel.rotation.x = Math.PI / 2
      barrel.position.set(side, 0.45, 1.5)
      this.turretHead.add(barrel)
    }

    this.muzzle = new THREE.Object3D()
    this.muzzle.position.set(0, 0.45, 2.8)
    this.turretHead.add(this.muzzle)

    this.shieldMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(3.8, 1),
      new THREE.MeshBasicMaterial({
        color: TEAM_COLORS[this.ownerTeam],
        wireframe: true,
        transparent: true,
        opacity: 0.32,
      })
    )
    this.shieldMesh.position.y = 2.5
    this.group.add(this.shieldMesh)

    const ringGeometry = new THREE.RingGeometry(TOWER_CAPTURE_RADIUS - 0.55, TOWER_CAPTURE_RADIUS, 48)
    const points = ringGeometry.attributes.position
    for (let i = 0; i < points.count; i++) {
      const rx = points.getX(i)
      const rz = points.getY(i)
      const worldY = this.scene.terrain2.getHeightAtPosition(this.position.x + rx, this.position.z + rz)
      points.setXYZ(i, rx, worldY - this.position.y + 0.18, rz)
    }
    ringGeometry.computeBoundingSphere()

    this.ringMat = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[this.ownerTeam],
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.ringMesh = new THREE.Mesh(ringGeometry, this.ringMat)
    this.group.add(this.ringMesh)

    const dangerGeo = new THREE.RingGeometry(TOWER_TURRET_RANGE - 0.55, TOWER_TURRET_RANGE, 64)
    const dangerPts = dangerGeo.attributes.position
    for (let i = 0; i < dangerPts.count; i++) {
      const rx = dangerPts.getX(i)
      const rz = dangerPts.getY(i)
      const worldY = this.scene.terrain2.getHeightAtPosition(this.position.x + rx, this.position.z + rz)
      dangerPts.setXYZ(i, rx, worldY - this.position.y + 0.22, rz)
    }
    dangerGeo.computeBoundingSphere()
    this.dangerRingMat = new THREE.MeshBasicMaterial({
      color: 0xff4d4d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    this.dangerRingMesh = new THREE.Mesh(dangerGeo, this.dangerRingMat)
    this.group.add(this.dangerRingMesh)

    this.beaconMat = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[this.ownerTeam],
      transparent: true,
      opacity: 0.45,
    })
    this.beaconMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 22, 8), this.beaconMat)
    this.beaconMesh.position.y = 11
    this.group.add(this.beaconMesh)

    this.labelCanvas = document.createElement('canvas')
    this.labelCanvas.width = 512
    this.labelCanvas.height = 160
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas)
    this.labelSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTexture, transparent: true, depthTest: false })
    )
    this.labelSprite.position.set(0, 9.5, 0)
    this.labelSprite.scale.set(13, 4.1, 1)
    this.group.add(this.labelSprite)
  }

  buildMinimapMarker() {
    const markerGeo = new THREE.CircleGeometry(18, 16)
    this.minimapMat = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[this.ownerTeam],
      side: THREE.DoubleSide,
    })
    this.minimapMarker = new THREE.Mesh(markerGeo, this.minimapMat)
    this.minimapMarker.rotation.x = -Math.PI / 2
    this.minimapMarker.position.set(0, 25, 0)
    this.minimapMarker.layers.set(1)
    this.group.add(this.minimapMarker)
  }

  updateHitBox() {
    this.hitBox.setFromCenterAndSize(
      new THREE.Vector3(this.position.x, this.position.y + 2.6, this.position.z),
      new THREE.Vector3(6.0, 5.8, 6.0)
    )
  }

  refreshVisuals() {
    const teamColor = TEAM_COLORS[this.ownerTeam] || TEAM_COLORS.neutral
    const shieldUp = this.hasTurret && this.turretHp > 0
    this.turretHead.visible = this.hasTurret
    this.teamBand.material.color.setHex(teamColor)
    this.flagClothMat.color.setHex(teamColor)
    this.beaconMat.color.setHex(teamColor)
    this.minimapMat.color.setHex(teamColor)
    this.shieldMesh.visible = shieldUp
    this.shieldMesh.material.color.setHex(teamColor)

    if (this.ownerTeam === 'blue') {
      this.ringMat.color.setHex(TEAM_COLORS.blue)
    } else {
      this.ringMat.color.setHex(shieldUp ? teamColor : 0x85e8a5)
    }

    if (this.dangerRingMesh) {
      this.dangerRingMesh.visible = shieldUp && this.ownerTeam === 'red'
    }

    const ctx = this.labelCanvas.getContext('2d')
    ctx.clearRect(0, 0, 512, 160)
    ctx.fillStyle = 'rgba(14, 18, 24, 0.9)'
    ctx.fillRect(6, 6, 500, 148)
    ctx.strokeStyle = shieldUp ? TEAM_CSS[this.ownerTeam] || '#ffc65c' : '#85e8a5'
    ctx.lineWidth = 5
    ctx.strokeRect(6, 6, 500, 148)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.textAlign = 'left'
    const headerTitle = !this.hasTurret
      ? `${this.name.toUpperCase()} FLAG`
      : this.armoredAgainstLightGun
      ? `${this.name.toUpperCase()} BUNKER`
      : `${this.name.toUpperCase()} TURRET`
    ctx.fillText(headerTitle, 24, 42)

    ctx.fillStyle = TEAM_CSS[this.ownerTeam] || '#ffc65c'
    ctx.font = 'bold 24px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(this.ownerTeam.toUpperCase(), 486, 42)

    ctx.fillStyle = '#252d38'
    ctx.fillRect(24, 62, 464, 24)
    const hpRatio = Math.max(0, Math.min(1, this.turretHp / this.maxTurretHp))
    if (this.ownerTeam === 'blue') {
      ctx.fillStyle = '#4da6ff'
      ctx.fillRect(24, 62, 464, 24)
    } else if (shieldUp) {
      ctx.fillStyle = hpRatio > 0.4 ? '#ff9f43' : '#ff5252'
      ctx.fillRect(24, 62, 464 * hpRatio, 24)
    } else {
      ctx.fillStyle = '#85e8a5'
      ctx.fillRect(24, 62, 464 * Math.max(0.08, this.captureProgress), 24)
    }

    ctx.fillStyle = '#d8e1ec'
    ctx.font = 'bold 21px system-ui, sans-serif'
    ctx.textAlign = 'center'
    let statusLine = ''
    if (this.ownerTeam === 'blue') {
      statusLine = 'SECTOR CONQUERED!'
    } else if (shieldUp) {
      statusLine = this.armoredAgainstLightGun
        ? `ARMORED BUNKER: ${Math.ceil(this.turretHp)}% · NEEDS HEAVY CANNON`
        : `TURRET HP: ${Math.ceil(this.turretHp)}% · AIM & LEFT-CLICK`
    } else if (this.captureProgress > 0) {
      statusLine = `CAPTURING FLAG… ${Math.round(this.captureProgress * 100)}%`
    } else {
      statusLine = 'RING UNLOCKED! DRIVE IN & HOLD 3S'
    }
    ctx.fillText(statusLine, 256, 124)

    this.labelTexture.needsUpdate = true
  }

  takeDamage(amount = 25, weaponType = 'machineGun') {
    if (!this.hasTurret || this.turretHp <= 0) return false
    if (this.armoredAgainstLightGun && weaponType === 'machineGun') {
      this.scene.showBanner?.('HEAVY BUNKER ARMOR DEFLECTED ROOF GUN — TOW AMMO TO FRIENDLY CANNON!')
      return false
    }

    this.turretHp = Math.max(0, this.turretHp - amount)
    this.hitFlashTimer = 0.16
    this.armorMat.emissive.setHex(0xff6b2b)

    if (this.turretHp === 0) {
      this.rebuildTimer = 45
      playExplosionSound()
      this.scene.effects?.impact2(
        new THREE.Vector3(this.position.x, this.position.y + 3.0, this.position.z)
      )
      this.scene.showBanner?.(`${this.name.toUpperCase()} TURRET DESTROYED! DRIVE INTO GREEN RING FOR 3S`)
    }
    this.refreshVisuals()
    this.scene.renderHud?.()
    return true
  }

  serialize() {
    return {
      id: this.id,
      ownerTeam: this.ownerTeam,
      turretHp: Math.round(this.turretHp),
    }
  }

  applyState(data) {
    if (!data) return
    const changedOwner = data.ownerTeam && data.ownerTeam !== this.ownerTeam
    const changedHp = typeof data.turretHp === 'number' && data.turretHp !== this.turretHp
    if (data.ownerTeam) this.ownerTeam = data.ownerTeam
    if (typeof data.turretHp === 'number') this.turretHp = data.turretHp
    if (changedOwner || changedHp) {
      this.refreshVisuals()
    }
    return changedOwner
  }

  update(dt, playerTruckPos, playerTeam) {
    this.shieldMesh.rotation.y += dt * 0.6
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt)
      if (this.hitFlashTimer === 0) {
        this.armorMat.emissive.setHex(0x000000)
      }
    }

    if (this.hasTurret && this.turretHp <= 0 && this.ownerTeam !== 'blue') {
      this.smokeTimer -= dt
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.18
        this.scene.effects?.emit(
          new THREE.Vector3(this.position.x, this.position.y + 3.2, this.position.z),
          {
            square: true,
            color: 0x555b60,
            smoke: true,
            size: 0.7,
            endSize: 2.2,
            life: 1.5,
            opacity: 0.42,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.8, (Math.random() - 0.5) * 1.2),
          }
        )
      }
    } else if (this.hasTurret && this.turretHp > 0) {
      let targetPos = null
      let bestDist = TOWER_TURRET_RANGE

      if (this.ownerTeam !== playerTeam && playerTruckPos) {
        const d = this.position.distanceTo(playerTruckPos)
        if (d < bestDist) {
          bestDist = d
          targetPos = playerTruckPos
        }
      }

      if (this.scene.aiRaider && this.scene.aiRaider.alive && this.ownerTeam !== this.scene.aiRaider.team) {
        const d = this.position.distanceTo(this.scene.aiRaider.position)
        if (d < bestDist) {
          bestDist = d
          targetPos = this.scene.aiRaider.position
        }
      }

      if (targetPos) {
        this.turretHead.lookAt(targetPos.x, this.turretHead.getWorldPosition(this.muzzleWorld).y, targetPos.z)
        this.fireCooldown -= dt
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 0.42
          this.turretHead.updateMatrixWorld(true)
          this.muzzle.getWorldPosition(this.muzzleWorld)
          const dx = targetPos.x - this.muzzleWorld.x
          const dy = targetPos.y + 1.1 - this.muzzleWorld.y
          const dz = targetPos.z - this.muzzleWorld.z
          const horizDist = Math.hypot(dx, dz)
          const speed = 52
          const gravity = 9.8
          const flightTime = Math.max(0.18, horizDist / speed)
          this.aimDir.set(
            dx / flightTime,
            (dy + 0.5 * gravity * flightTime * flightTime) / flightTime,
            dz / flightTime
          )
          this.scene.fireBallistic('machineGunRed', this.muzzleWorld, this.aimDir, this.ownerTeam, false)
        }
      }
    }

    if (playerTruckPos) {
      const horizDist = Math.hypot(playerTruckPos.x - this.position.x, playerTruckPos.z - this.position.z)
      const inRing = horizDist <= TOWER_CAPTURE_RADIUS && Math.abs(playerTruckPos.y - this.position.y) < 6

      if (inRing && this.ownerTeam !== playerTeam) {
        if (this.hasTurret && this.turretHp > 0) {
          this.captureProgress = 0
          return { inRing: true, shielded: true }
        }
        this.capturingTeam = playerTeam
        this.captureProgress = Math.min(1, this.captureProgress + dt / TOWER_CAPTURE_SECONDS)
        this.refreshVisuals()
        if (this.captureProgress >= 1) {
          this.ownerTeam = playerTeam
          this.captureProgress = 1
          this.capturingTeam = null
          this.refreshVisuals()
          playFlagCaptureSound()
          this.scene.onTowerCaptured(this)
          return { inRing: true, captured: true }
        }
        return { inRing: true, capturing: true, progress: this.captureProgress }
      }
    }

    if (this.captureProgress > 0 && this.ownerTeam !== 'blue') {
      this.captureProgress = Math.max(0, this.captureProgress - dt * 0.5)
      this.refreshVisuals()
    }

    return { inRing: false }
  }
}

export class FriendlyHeavyCannon {
  constructor(scene, position, targetTower) {
    this.scene = scene
    this.position = position.clone()
    this.targetTower = targetTower
    this.ownerTeam = 'blue'
    this.ammoLoaded = false
    this.notifiedTargetDestroyed = false
    this.fireCooldown = 0.35
    this.recoilOffset = 0

    this.group = new THREE.Group()
    this.group.name = 'FriendlyHeavyCannon'
    this.group.position.copy(this.position)
    this.scene.scene.add(this.group)

    this.muzzleWorld = new THREE.Vector3()
    this.aimDir = new THREE.Vector3()

    this.buildVisuals()
    this.buildMinimapMarker()
    this.aimTowardTarget()
    this.refreshVisuals()
  }

  buildVisuals() {
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x39444c, roughness: 0.85, metalness: 0.25 })
    const oliveMat = new THREE.MeshStandardMaterial({ color: 0x4f5d43, roughness: 0.6, metalness: 0.45 })
    const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x1f262a, roughness: 0.45, metalness: 0.75 })
    const blueMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS.blue, roughness: 0.4 })
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe6b84d, roughness: 0.35, metalness: 0.8 })
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5b3e, roughness: 0.8 })

    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.6, 1.4, 10), concreteMat)
    plinth.position.y = 0.7
    plinth.castShadow = true
    plinth.receiveShadow = true
    this.group.add(plinth)

    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.12, 3.12, 0.32, 10), blueMat)
    band.position.y = 1.25
    this.group.add(band)

    this.turretPivot = new THREE.Group()
    this.turretPivot.position.y = 1.45
    this.group.add(this.turretPivot)

    const breechHouse = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.35, 2.5), oliveMat)
    breechHouse.position.y = 0.68
    breechHouse.castShadow = true
    this.turretPivot.add(breechHouse)

    this.barrelPivot = new THREE.Group()
    this.barrelPivot.position.set(0, 0.95, 0.6)
    this.barrelPivot.rotation.x = -0.28
    this.turretPivot.add(this.barrelPivot)

    this.recoilGroup = new THREE.Group()
    this.barrelPivot.add(this.recoilGroup)

    const mainBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 4.8, 12), darkSteelMat)
    mainBarrel.rotation.x = Math.PI / 2
    mainBarrel.position.z = 2.2
    mainBarrel.castShadow = true
    this.recoilGroup.add(mainBarrel)

    const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.55), blueMat)
    muzzleBrake.position.z = 4.6
    this.recoilGroup.add(muzzleBrake)

    this.muzzle = new THREE.Object3D()
    this.muzzle.position.set(0, 0, 4.95)
    this.recoilGroup.add(this.muzzle)

    this.ammoStackGroup = new THREE.Group()
    this.ammoStackGroup.position.set(-2.2, 1.4, -0.8)
    this.ammoStackGroup.visible = false
    this.group.add(this.ammoStackGroup)

    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.75, 1.0), crateMat)
    crate.position.y = 0.38
    this.ammoStackGroup.add(crate)
    for (let i = 0; i < 3; i++) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.1, 8), brassMat)
      shell.rotation.z = Math.PI / 2
      shell.position.set(0, 0.9, -0.28 + i * 0.28)
      this.ammoStackGroup.add(shell)
    }

    const ringGeo = new THREE.RingGeometry(
      FRIENDLY_CANNON_RING_RADIUS - 0.55,
      FRIENDLY_CANNON_RING_RADIUS,
      48
    )
    const pts = ringGeo.attributes.position
    for (let i = 0; i < pts.count; i++) {
      const rx = pts.getX(i)
      const rz = pts.getY(i)
      const worldY = this.scene.terrain2.getHeightAtPosition(this.position.x + rx, this.position.z + rz)
      pts.setXYZ(i, rx, worldY - this.position.y + 0.2, rz)
    }
    ringGeo.computeBoundingSphere()

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffc65c,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.ringMesh = new THREE.Mesh(ringGeo, this.ringMat)
    this.group.add(this.ringMesh)

    this.labelCanvas = document.createElement('canvas')
    this.labelCanvas.width = 512
    this.labelCanvas.height = 144
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas)
    this.labelSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTexture, transparent: true, depthTest: false })
    )
    this.labelSprite.position.set(0, 7.2, 0)
    this.labelSprite.scale.set(12.5, 3.5, 1)
    this.group.add(this.labelSprite)
  }

  buildMinimapMarker() {
    const markerGeo = new THREE.CircleGeometry(14, 16)
    this.minimapMat = new THREE.MeshBasicMaterial({
      color: 0xffc65c,
      side: THREE.DoubleSide,
    })
    this.minimapMarker = new THREE.Mesh(markerGeo, this.minimapMat)
    this.minimapMarker.rotation.x = -Math.PI / 2
    this.minimapMarker.position.set(0, 24, 0)
    this.minimapMarker.layers.set(1)
    this.group.add(this.minimapMarker)
  }

  aimTowardTarget() {
    if (!this.targetTower) return
    const worldPos = new THREE.Vector3()
    this.turretPivot.getWorldPosition(worldPos)
    this.turretPivot.lookAt(this.targetTower.position.x, worldPos.y, this.targetTower.position.z)
  }

  refreshVisuals() {
    const targetAlive = this.targetTower && this.targetTower.turretHp > 0
    this.ammoStackGroup.visible = this.ammoLoaded
    this.ringMat.color.setHex(this.ammoLoaded ? 0x85e8a5 : 0xffc65c)
    this.minimapMat.color.setHex(this.ammoLoaded ? TEAM_COLORS.blue : 0xffc65c)

    const ctx = this.labelCanvas.getContext('2d')
    ctx.clearRect(0, 0, 512, 144)
    ctx.fillStyle = 'rgba(12, 18, 26, 0.92)'
    ctx.fillRect(6, 6, 500, 132)
    ctx.strokeStyle = this.ammoLoaded ? '#85e8a5' : '#ffc65c'
    ctx.lineWidth = 5
    ctx.strokeRect(6, 6, 500, 132)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 26px system-ui, sans-serif'
    ctx.textAlign = 'center'
    const mainTitle = !this.ammoLoaded
      ? 'FRIENDLY CANNON — NEEDS AMMO'
      : targetAlive
      ? 'AMMO LOADED — SHELLING TARGET!'
      : 'BUNKER DESTROYED — CAPTURE FLAG!'
    ctx.fillText(mainTitle, 256, 52)

    ctx.fillStyle = this.ammoLoaded ? '#85e8a5' : '#ffe066'
    ctx.font = 'bold 21px system-ui, sans-serif'
    const subText = !this.ammoLoaded
      ? 'TOW AMMO TRAILER INTO 10M GOLD RING'
      : targetAlive
      ? `FIRING 155MM SHELLS AT ${this.targetTower.name.toUpperCase()}`
      : 'DRIVE DOWN INTO GREEN FLAG RING (3S)'
    ctx.fillText(subText, 256, 102)

    this.labelTexture.needsUpdate = true
  }

  loadAmmo(ammoTrailer) {
    if (this.ammoLoaded) return
    this.ammoLoaded = true
    this.fireCooldown = 0.25

    if (ammoTrailer) {
      ammoTrailer.delivered = true
      if (this.scene.hitchCoupler?.coupled) {
        this.scene.hitchCoupler.dropTrailer()
      }
      ammoTrailer.trailer.setParked(true)
      ammoTrailer.refreshBillboard()
    }

    this.refreshVisuals()
    this.scene.onAmmoDelivered?.()
    this.scene.showBanner?.('AMMO LOADED — SHELLING TARGET!')
    this.scene.renderHud?.()
  }

  fireAtTarget() {
    if (!this.targetTower || this.targetTower.turretHp <= 0) return

    this.aimTowardTarget()
    this.group.updateMatrixWorld(true)
    this.muzzle.getWorldPosition(this.muzzleWorld)

    const targetPoint = new THREE.Vector3(
      this.targetTower.position.x,
      this.targetTower.position.y + 2.6,
      this.targetTower.position.z
    )
    const dx = targetPoint.x - this.muzzleWorld.x
    const dy = targetPoint.y - this.muzzleWorld.y
    const dz = targetPoint.z - this.muzzleWorld.z
    const horizDist = Math.hypot(dx, dz)
    const speed = 56
    const gravity = 14.0
    const flightTime = Math.max(0.25, horizDist / speed)

    this.aimDir.set(
      dx / flightTime,
      (dy + 0.5 * gravity * flightTime * flightTime) / flightTime,
      dz / flightTime
    )

    this.recoilOffset = -0.55
    playExplosionSound()
    this.scene.fireBallistic('artillery', this.muzzleWorld, this.aimDir, this.ownerTeam)
  }

  update(dt, ammoTrailer) {
    if (this.recoilOffset < 0) {
      this.recoilOffset = Math.min(0, this.recoilOffset + dt * 1.4)
      this.recoilGroup.position.z = this.recoilOffset
    }

    if (!this.ammoLoaded && ammoTrailer?.chassis) {
      const horizDist = Math.hypot(
        ammoTrailer.chassis.position.x - this.position.x,
        ammoTrailer.chassis.position.z - this.position.z
      )
      if (horizDist <= FRIENDLY_CANNON_RING_RADIUS) {
        this.loadAmmo(ammoTrailer)
      }
    }

    if (this.ammoLoaded) {
      if (this.targetTower && this.targetTower.turretHp > 0) {
        this.aimTowardTarget()
        this.fireCooldown -= dt
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 1.05
          this.fireAtTarget()
        }
      } else if (!this.notifiedTargetDestroyed) {
        this.notifiedTargetDestroyed = true
        this.refreshVisuals()
      }
    }
  }

  dispose() {
    this.scene.scene.remove(this.group)
    this.labelTexture.dispose()
  }
}

export class SiegeTrailer {
  constructor(scene, { id, type = 'artillery', ownerTeam = 'red', position }) {
    this.scene = scene
    this.id = id
    this.type = type
    this.ownerTeam = ownerTeam
    this.hp = 100
    this.autoFireCooldown = 1.2
    this.delivered = false

    this.trailer = new Trailer(scene, position, '/assets/glb/small-trailer.glb')
    for (let i = 0; i < this.trailer.vehicle.getNumWheels(); i++) {
      this.trailer.vehicle.updateWheelTransform(i, true)
    }
    this.trailer.update()
    this.trailer.setParked(true)

    this.coupler = new HitchCoupler(scene.car, this.trailer, {
      attractRadius: 5.5,
      lockRadius: 0.9,
      breakDistance: 2.8,
      breakImpulse: 3500,
    })

    this.muzzleWorld = new THREE.Vector3()
    this.aimDir = new THREE.Vector3()
    this.statusTargetName = ''

    this.buildWeaponMount()
    this.refreshBillboard()
  }

  get chassis() {
    return this.trailer.chassis
  }

  get isCoupled() {
    return this.coupler.coupled
  }

  get isDeployed() {
    return !this.coupler.coupled && !!this.trailer.parked
  }

  buildWeaponMount() {
    this.mountGroup = new THREE.Group()
    this.mountGroup.position.set(0, 0.55, 0)
    this.trailer.chassis.add(this.mountGroup)

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x262f34, roughness: 0.65, metalness: 0.5 })
    const oliveMat = new THREE.MeshStandardMaterial({
      color: this.type === 'sentry' ? 0x3b4d5e : 0x5c6444,
      roughness: 0.6,
      metalness: 0.4,
    })
    const accentMat = new THREE.MeshStandardMaterial({
      color: TEAM_COLORS[this.ownerTeam] || 0xffc65c,
      roughness: 0.4,
    })
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xf0c24b,
      roughness: 0.3,
      metalness: 0.8,
    })

    this.teamAccentMat = accentMat
    this.stabilizers = []

    for (const side of [-0.95, 0.95]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.65, 0.14), darkMat)
      leg.position.set(side, 0.05, -0.3)
      this.mountGroup.add(leg)
      this.stabilizers.push(leg)
    }

    if (this.type === 'ammo') {
      const crateA = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.68, 1.05), oliveMat)
      crateA.position.set(0, 0.34, -0.45)
      crateA.castShadow = true
      this.mountGroup.add(crateA)

      const crateB = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.68, 1.05), oliveMat)
      crateB.position.set(0, 0.34, 0.72)
      crateB.castShadow = true
      this.mountGroup.add(crateB)

      const strap = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 2.3), accentMat)
      strap.position.set(0, 0.72, 0.14)
      this.mountGroup.add(strap)

      for (const xOff of [-0.36, 0, 0.36]) {
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.65, 10), brassMat)
        shell.rotation.x = Math.PI / 2
        shell.position.set(xOff, 0.92, 0.12)
        shell.castShadow = true
        this.mountGroup.add(shell)
      }
    } else {
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.45, 10), darkMat)
      plinth.position.y = 0.22
      this.mountGroup.add(plinth)

      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.14, 10), accentMat)
      band.position.y = 0.35
      this.mountGroup.add(band)

      this.turretPivot = new THREE.Group()
      this.turretPivot.position.y = 0.55
      this.mountGroup.add(this.turretPivot)

      if (this.type === 'artillery') {
        const breech = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.68, 1.35), oliveMat)
        breech.position.y = 0.3
        this.turretPivot.add(breech)

        this.barrelPivot = new THREE.Group()
        this.barrelPivot.position.set(0, 0.45, 0.3)
        this.barrelPivot.rotation.x = -0.32
        this.turretPivot.add(this.barrelPivot)

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.9, 12), darkMat)
        barrel.rotation.x = Math.PI / 2
        barrel.position.z = 1.35
        this.barrelPivot.add(barrel)

        const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.35), accentMat)
        muzzleBrake.position.z = 2.8
        this.barrelPivot.add(muzzleBrake)

        this.muzzle = new THREE.Object3D()
        this.muzzle.position.set(0, 0, 3.05)
        this.barrelPivot.add(this.muzzle)
      } else {
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 1.05), oliveMat)
        housing.position.y = 0.28
        this.turretPivot.add(housing)

        this.barrelPivot = new THREE.Group()
        this.barrelPivot.position.set(0, 0.32, 0.35)
        this.turretPivot.add(this.barrelPivot)

        for (const side of [-0.24, 0.24]) {
          const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.65, 8), darkMat)
          gun.rotation.x = Math.PI / 2
          gun.position.set(side, 0, 0.75)
          this.barrelPivot.add(gun)
        }

        this.muzzle = new THREE.Object3D()
        this.muzzle.position.set(0, 0, 1.65)
        this.barrelPivot.add(this.muzzle)
      }
    }

    this.labelCanvas = document.createElement('canvas')
    this.labelCanvas.width = 384
    this.labelCanvas.height = 96
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas)
    this.labelSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.labelTexture, transparent: true, depthTest: false })
    )
    this.labelSprite.position.set(0, 2.8, 0)
    this.labelSprite.scale.set(7.5, 1.85, 1)
    this.mountGroup.add(this.labelSprite)
  }

  refreshBillboard() {
    const ctx = this.labelCanvas.getContext('2d')
    ctx.clearRect(0, 0, 384, 96)
    ctx.fillStyle = 'rgba(12, 16, 22, 0.88)'
    ctx.fillRect(4, 4, 376, 88)
    ctx.strokeStyle = this.type === 'ammo' ? '#ffc65c' : TEAM_CSS[this.ownerTeam] || '#ffc65c'
    ctx.lineWidth = 4
    ctx.strokeRect(4, 4, 376, 88)

    const title =
      this.type === 'ammo'
        ? '155MM AMMO TRAILER'
        : this.type === 'artillery'
        ? '120MM SIEGE ARTILLERY'
        : 'TWIN AUTO-SENTRY'
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(title, 192, 34)

    ctx.fillStyle = this.delivered ? '#85e8a5' : this.isCoupled ? '#ffc65c' : '#85e8a5'
    ctx.font = 'bold 18px system-ui, sans-serif'
    let sub = ''
    if (this.type === 'ammo') {
      sub = this.delivered
        ? 'AMMO DELIVERED TO CANNON!'
        : this.isCoupled
        ? 'TOW TO FRIENDLY CANNON RING'
        : 'BACK UP (S) TO HITCH AMMO'
    } else {
      sub = this.isCoupled
        ? 'TOWED · PRESS T TO DEPLOY'
        : this.statusTargetName
        ? `DEPLOYED · TARGETING ${this.statusTargetName}`
        : `DEPLOYED (${this.type === 'artillery' ? '135m SIEGE' : '60m GUARD'})`
    }
    ctx.fillText(sub, 192, 68)
    this.labelTexture.needsUpdate = true
  }

  fireManualOrTarget(customTargetPoint = null) {
    if (this.type === 'ammo' || !this.muzzle) return
    let targetPoint = customTargetPoint
    if (!targetPoint) {
      const nearestTower = this.findNearestHostileTower()
      if (nearestTower) {
        targetPoint = new THREE.Vector3(
          nearestTower.position.x,
          nearestTower.position.y + 2.4,
          nearestTower.position.z
        )
      }
    }

    this.chassis.updateMatrixWorld(true)
    this.muzzle.getWorldPosition(this.muzzleWorld)

    if (targetPoint) {
      this.turretPivot.lookAt(targetPoint.x, this.muzzleWorld.y, targetPoint.z)
      this.chassis.updateMatrixWorld(true)
      this.muzzle.getWorldPosition(this.muzzleWorld)
      this.muzzleWorld.y += 1.2

      const dx = targetPoint.x - this.muzzleWorld.x
      const dz = targetPoint.z - this.muzzleWorld.z
      const dy = targetPoint.y - this.muzzleWorld.y
      const horizDist = Math.hypot(dx, dz)
      const gravity = this.type === 'artillery' ? 14.0 : 12.0
      const speed = this.type === 'artillery' ? 56 : 68
      const flightTime = Math.max(0.25, horizDist / speed)
      const vx = dx / flightTime
      const vz = dz / flightTime
      const vy = (dy + 0.5 * gravity * flightTime * flightTime) / flightTime

      this.aimDir.set(vx, vy, vz)
    } else {
      this.muzzle.getWorldDirection(this.aimDir)
    }

    const weaponKey = this.type === 'artillery' ? 'artillery' : 'machineGun'
    this.scene.fireBallistic(weaponKey, this.muzzleWorld, this.aimDir, this.ownerTeam, true)
  }

  findNearestHostileTower() {
    let best = null
    let bestDist = this.type === 'artillery' ? ARTILLERY_RANGE : SENTRY_RANGE
    for (const tower of this.scene.towers) {
      if (tower.ownerTeam === this.ownerTeam || tower.turretHp <= 0) continue
      const d = this.chassis.position.distanceTo(tower.position)
      if (d <= bestDist) {
        bestDist = d
        best = tower
      }
    }
    return best
  }

  update(dt, isActiveCandidate) {
    this.trailer.update()

    if (isActiveCandidate && !this.delivered) {
      const wasCoupled = this.coupler.coupled
      this.coupler.update(dt)
      if (!wasCoupled && this.coupler.coupled) {
        this.ownerTeam = this.scene.playerTeam
        this.teamAccentMat.color.setHex(TEAM_COLORS[this.ownerTeam])
        this.trailer.setParked(false)
        this.statusTargetName = ''
        this.refreshBillboard()
        this.scene.onTrailerStateChanged(this, 'hitched')
      } else if (wasCoupled && !this.coupler.coupled) {
        this.trailer.setParked(true)
        this.refreshBillboard()
        this.scene.onTrailerStateChanged(this, 'deployed')
      }
    }

    for (const leg of this.stabilizers) {
      leg.position.y = this.isDeployed ? -0.15 : 0.15
    }

    if (this.type === 'ammo') return

    if (this.isDeployed) {
      if (this.type === 'artillery') {
        const targetTower = this.findNearestHostileTower()
        const newTargetName = targetTower ? targetTower.name.toUpperCase() : ''
        if (newTargetName !== this.statusTargetName) {
          this.statusTargetName = newTargetName
          this.refreshBillboard()
        }
        if (targetTower) {
          this.turretPivot.lookAt(
            targetTower.position.x,
            this.turretPivot.getWorldPosition(this.muzzleWorld).y,
            targetTower.position.z
          )
          this.autoFireCooldown -= dt
          if (this.autoFireCooldown <= 0) {
            this.autoFireCooldown = 2.4
            this.fireManualOrTarget(
              new THREE.Vector3(
                targetTower.position.x,
                targetTower.position.y + 2.4,
                targetTower.position.z
              )
            )
          }
        }
      } else {
        let targetPos = null
        let targetLabel = ''
        if (
          this.scene.aiRaider &&
          this.scene.aiRaider.alive &&
          this.scene.aiRaider.team !== this.ownerTeam &&
          this.chassis.position.distanceTo(this.scene.aiRaider.position) <= SENTRY_RANGE
        ) {
          targetPos = this.scene.aiRaider.position
          targetLabel = 'RAIDER TRUCK'
        } else {
          const tower = this.findNearestHostileTower()
          if (tower) {
            targetPos = tower.position
            targetLabel = tower.name.toUpperCase()
          }
        }

        if (targetLabel !== this.statusTargetName) {
          this.statusTargetName = targetLabel
          this.refreshBillboard()
        }

        if (targetPos) {
          this.turretPivot.lookAt(
            targetPos.x,
            this.turretPivot.getWorldPosition(this.muzzleWorld).y,
            targetPos.z
          )
          this.autoFireCooldown -= dt
          if (this.autoFireCooldown <= 0) {
            this.autoFireCooldown = 0.25
            this.fireManualOrTarget(new THREE.Vector3(targetPos.x, targetPos.y + 1.5, targetPos.z))
          }
        }
      }
    }
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      ownerTeam: this.ownerTeam,
      x: Number(this.chassis.position.x.toFixed(2)),
      y: Number(this.chassis.position.y.toFixed(2)),
      z: Number(this.chassis.position.z.toFixed(2)),
      qx: Number(this.chassis.quaternion.x.toFixed(3)),
      qy: Number(this.chassis.quaternion.y.toFixed(3)),
      qz: Number(this.chassis.quaternion.z.toFixed(3)),
      qw: Number(this.chassis.quaternion.w.toFixed(3)),
    }
  }

  applyState(data) {
    if (this.isCoupled) return
    this.ownerTeam = data.ownerTeam || this.ownerTeam
    this.teamAccentMat.color.setHex(TEAM_COLORS[this.ownerTeam] || 0xffc65c)
    this.trailer.setParked(true)
    this.chassis.position.set(data.x, data.y, data.z)
    this.chassis.quaternion.set(data.qx || 0, data.qy || 0, data.qz || 0, data.qw ?? 1)

    const body = this.chassis.body?.ammo
    if (body) {
      const transform = new Ammo.btTransform()
      const origin = new Ammo.btVector3(data.x, data.y, data.z)
      const rot = new Ammo.btQuaternion(data.qx || 0, data.qy || 0, data.qz || 0, data.qw ?? 1)
      transform.setIdentity()
      transform.setOrigin(origin)
      transform.setRotation(rot)
      body.setWorldTransform(transform)
      body.getMotionState()?.setWorldTransform(transform)
      Ammo.destroy(origin)
      Ammo.destroy(rot)
      Ammo.destroy(transform)
    }

    this.trailer.update()
    this.refreshBillboard()
  }

  dispose() {
    this.coupler.dispose()
    this.trailer.dispose()
    this.labelTexture.dispose()
  }
}

export class AiRaiderTruck {
  constructor(scene, waypoints) {
    this.scene = scene
    this.waypoints = waypoints
    this.waypointIndex = Math.min(4, waypoints.length - 1)
    this.team = 'blue'
    this.hp = 100
    this.maxHp = 100
    this.alive = true
    this.respawnTimer = 0
    this.fireCooldown = 0.8
    this.speed = 11

    const start = waypoints[this.waypointIndex] || new THREE.Vector3(0, 5, 0)
    this.position = new THREE.Vector3(start.x + 8, start.y + 0.6, start.z + 8)
    this.hitBox = new THREE.Box3()
    this.muzzleWorld = new THREE.Vector3()
    this.aimDir = new THREE.Vector3()

    const truckScene = scene.getGltf('/assets/glb/blockbench-truck.glb').scene.clone(true)
    this.mesh = truckScene
    this.mesh.position.copy(this.position)
    this.scene.scene.add(this.mesh)

    this.badge = new THREE.Mesh(
      new THREE.ConeGeometry(0.95, 1.6, 4),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS.blue })
    )
    this.badge.position.set(0, 3.6, 0)
    this.badge.rotation.x = Math.PI
    this.mesh.add(this.badge)
  }

  setEnemyOf(playerTeam) {
    this.team = playerTeam === 'red' ? 'blue' : 'red'
    this.badge.material.color.setHex(TEAM_COLORS[this.team])
  }

  takeDamage(amount) {
    if (!this.alive) return
    this.hp = Math.max(0, this.hp - amount)
    if (this.hp === 0) {
      this.alive = false
      this.respawnTimer = 12
      this.mesh.visible = false
      playExplosionSound()
      this.scene.effects.impact2(this.position)
      this.scene.showBanner('ENEMY RAIDER TRUCK DESTROYED!')
    }
  }

  update(dt, playerPos) {
    if (!this.alive) {
      this.respawnTimer -= dt
      if (this.respawnTimer <= 0) {
        this.alive = true
        this.hp = this.maxHp
        this.mesh.visible = true
      }
      return
    }

    const targetWp = this.waypoints[this.waypointIndex]
    if (targetWp) {
      const dx = targetWp.x - this.position.x
      const dz = targetWp.z - this.position.z
      const dist = Math.hypot(dx, dz)
      if (dist < 14) {
        this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length
      } else {
        const nx = dx / dist
        const nz = dz / dist
        this.position.x += nx * this.speed * dt
        this.position.z += nz * this.speed * dt
        this.position.y = this.scene.terrain2.getHeightAtPosition(this.position.x, this.position.z) + 0.5
        this.mesh.position.copy(this.position)
        this.mesh.rotation.y = Math.atan2(nx, nz)
      }
    }

    this.hitBox.setFromCenterAndSize(
      new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z),
      new THREE.Vector3(4.2, 3.2, 6.2)
    )

    if (playerPos && this.position.distanceTo(playerPos) < 48) {
      this.fireCooldown -= dt
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 0.55
        this.muzzleWorld.set(this.position.x, this.position.y + 2.6, this.position.z)
        const dx = playerPos.x - this.muzzleWorld.x
        const dy = playerPos.y + 1.1 - this.muzzleWorld.y
        const dz = playerPos.z - this.muzzleWorld.z
        const horizDist = Math.hypot(dx, dz)
        const speed = 52
        const gravity = 9.8
        const flightTime = Math.max(0.18, horizDist / speed)
        this.aimDir.set(
          dx / flightTime,
          (dy + 0.5 * gravity * flightTime * flightTime) / flightTime,
          dz / flightTime
        )
        this.scene.fireBallistic('machineGunRed', this.muzzleWorld, this.aimDir, this.team, false)
      }
    }
  }
}
