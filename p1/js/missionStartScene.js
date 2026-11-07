import * as THREE from 'three'
import { trackMissionStart } from './analytics.js'

const TRANSITION_MS = 1400
const MAP_FRUSTUM = 150
const MAP_FRUSTUM_END = 6
const MAP_RES = 160
const TRUCK_RES = 96
const TRUCK_ROTATION_SPEED = 0.004

export const MISSION_DEFS = [
  {
    id: 1,
    code: 'M1',
    favicon: '🚩',
    title: 'MISSION 1: CAPTURE THE FLAG',
    shortTitle: 'M1 · CAPTURE THE FLAG',
    payoutTag: 'STAGE 01',
    nextButtonLabel: 'NEXT MISSION: M2 TURRET ASSAULT ↗',
    nextMissionId: 2,
    description:
      "Drive down the valley into the flag's ring and hold for 3s to capture the sector.",
    steps: [
      '1. DRIVE DOWN THE VALLEY TOWARD TARGET FLAG',
      '2. ENTER THE UNLOCKED GREEN 10M CAPTURE RING',
      '3. HOLD FOR 3.0S TO CAPTURE THE SECTOR FLAG',
    ],
    mapLabel: 'TACTICAL MAP (SPAWN → TARGET FLAG)',
    deployBanner: 'MISSION 1: DRIVE INTO THE GREEN FLAG RING & HOLD FOR 3S!',
  },
  {
    id: 2,
    code: 'M2',
    favicon: '🔫',
    title: 'MISSION 2: TURRET ASSAULT',
    shortTitle: 'M2 · TURRET ASSAULT',
    payoutTag: 'STAGE 02',
    nextButtonLabel: 'NEXT MISSION: M3 AMMO DELIVERY ↗',
    nextMissionId: 3,
    description:
      "Aim your truck's roof gun with the mouse and Left-Click to destroy the defending turret, then capture the flag.",
    steps: [
      '1. AIM TRUCK ROOF GUN WITH MOUSE AT ENEMY TURRET',
      '2. LEFT-CLICK (OR PRESS F) TO DESTROY TURRET (4 HITS)',
      '3. DRIVE INTO UNLOCKED GREEN RING & HOLD FOR 3.0S',
    ],
    mapLabel: 'TACTICAL MAP (SPAWN → TURRET + FLAG)',
    deployBanner: 'MISSION 2: AIM ROOF GUN WITH MOUSE & LEFT-CLICK TO DESTROY TURRET!',
  },
  {
    id: 3,
    code: 'M3',
    favicon: '🧨',
    title: 'MISSION 3: AMMO DELIVERY',
    shortTitle: 'M3 · AMMO DELIVERY',
    payoutTag: 'STAGE 03',
    nextButtonLabel: 'JOIN ISLAND 1 — MULTIPLAYER CONQUEST ↗',
    nextMissionUrl: 'conquest.html?island=island-1',
    nextMissionId: 1,
    description:
      'Hitch the Ammo Trailer at Spawn and tow it to the Friendly Heavy Turret on the ridge so it can shell and destroy the enemy bunker, then capture the flag.',
    steps: [
      '1. BACK UP (S) AT SPAWN TO HITCH AMMO TRAILER',
      '2. TOW AMMO TRAILER TO FRIENDLY TURRET GOLD RING',
      '3. FRIENDLY CANNON SHELLS & DESTROYS HOSTILE BUNKER',
      '4. DRIVE INTO UNLOCKED GREEN RING FOR 3.0S TO CAPTURE',
    ],
    mapLabel: 'TACTICAL MAP (SPAWN + AMMO → FRIENDLY → FLAG)',
    deployBanner: 'MISSION 3: BACK UP (S) TO HITCH AMMO TRAILER & TOW TO FRIENDLY CANNON!',
  },
]

export function getMissionDef(missionId) {
  return MISSION_DEFS.find(m => m.id === Number(missionId)) || MISSION_DEFS[0]
}

export function setEmojiFavicon(emoji) {
  if (!emoji || typeof document === 'undefined') return
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class MissionStartScene {
  constructor(
    mainScene,
    {
      spawnPos,
      towerPos,
      friendlyCannonPos,
      towerRange = 58,
      selectedMission = 1,
      onSelectMission,
    },
    onComplete
  ) {
    this.mainScene = mainScene
    this.spawnPos = spawnPos.clone()
    this.towerPos = towerPos.clone()
    this.friendlyCannonPos = friendlyCannonPos ? friendlyCannonPos.clone() : null
    this.towerRange = towerRange
    this.selectedMission = getMissionDef(selectedMission).id
    this.onSelectMission = onSelectMission
    this.onComplete = onComplete
    this.isTransitioning = false
    this.keyHandler = this.handleKeyDown.bind(this)

    this.mapCenter = new THREE.Vector3(
      (this.spawnPos.x + this.towerPos.x) * 0.5,
      0,
      (this.spawnPos.z + this.towerPos.z) * 0.5
    )

    this.buildUI()
    this.setupMapRenderer()
    this.setupTruckPreview()
    this.updateSelectionUI()
    this.renderMap(false)
    document.body.classList.add('dispatch-active')
    document.addEventListener('keydown', this.keyHandler)
  }

  buildUI() {
    this.root = document.createElement('div')
    this.root.id = 'dispatch-screen'

    this.terminal = document.createElement('div')
    this.terminal.className = 'dispatch-terminal'

    const missionRowsHtml = MISSION_DEFS.map(
      m => `
        <li class="dispatch-load mission-option" data-mission="${m.id}">
          <span class="marker"></span>
          <span class="name">${m.title}</span>
          <span class="payout">${m.payoutTag}</span>
        </li>
      `
    ).join('')

    this.terminal.innerHTML = `
      <div class="dispatch-panel">
        <div class="dispatch-text">
          <div class="dispatch-header">SIEGE COMMAND · SELECT MISSION</div>
          <div class="dispatch-subheader" id="dispatch-mission-subheader"></div>
          <ul class="dispatch-loads" id="dispatch-mission-list">
            ${missionRowsHtml}
          </ul>
          <div class="dispatch-description" id="dispatch-mission-desc"></div>
          <div class="dispatch-route" id="dispatch-mission-steps"></div>
          <div class="dispatch-deploy-row">
            <button type="button" class="dispatch-deploy-btn" data-action="start" id="dispatch-deploy-btn">
              &gt; DEPLOY AT SPAWN POINT <span class="payout">START ↗</span>
            </button>
          </div>
          <div class="dispatch-hint">CLICK MISSION OR PRESS [↑/↓] TO SELECT · [ENTER] / [SPACE] TO DEPLOY · [\`] VERSION INFO</div>
        </div>
        <aside class="dispatch-visuals">
          <div class="dispatch-truck-wrap">
            <div class="dispatch-panel-label">SIEGE RIG</div>
            <div class="dispatch-truck-view">
              <canvas id="dispatch-truck"></canvas>
            </div>
          </div>
          <div class="dispatch-minimap-wrap">
            <div class="dispatch-panel-label" id="dispatch-map-label">TACTICAL MAP</div>
            <div class="dispatch-minimap">
              <canvas id="dispatch-map"></canvas>
              <canvas class="dispatch-map-overlay"></canvas>
            </div>
          </div>
        </aside>
      </div>
    `

    const missionList = this.terminal.querySelector('#dispatch-mission-list')
    missionList.addEventListener('click', event => {
      const row = event.target.closest('[data-mission]')
      if (!row || this.isTransitioning) return
      const clickedMission = Number(row.dataset.mission)
      this.selectMission(clickedMission)
    })

    const startItem = this.terminal.querySelector('[data-action="start"]')
    startItem.addEventListener('click', () => {
      if (!this.isTransitioning) this.confirm()
    })

    this.mapCanvas = this.terminal.querySelector('#dispatch-map')
    this.mapOverlay = this.terminal.querySelector('.dispatch-map-overlay')
    this.truckCanvas = this.terminal.querySelector('#dispatch-truck')

    this.mapCanvas.style.cursor = 'pointer'
    this.mapCanvas.addEventListener('click', () => {
      if (!this.isTransitioning) this.confirm()
    })

    this.root.appendChild(this.terminal)
    document.body.appendChild(this.root)
  }

  selectMission(missionId) {
    const def = getMissionDef(missionId)
    if (this.selectedMission !== def.id) {
      this.selectedMission = def.id
      this.onSelectMission?.(this.selectedMission)
    }
    setEmojiFavicon(def.favicon)
    this.updateSelectionUI()
    this.renderMap(false)
  }

  updateSelectionUI() {
    const def = getMissionDef(this.selectedMission)
    const distMeters = Math.round(
      Math.hypot(this.towerPos.x - this.spawnPos.x, this.towerPos.z - this.spawnPos.z)
    )

    const subheader = this.terminal.querySelector('#dispatch-mission-subheader')
    if (subheader) {
      subheader.textContent = `${def.title} (${distMeters}M)`
    }

    const desc = this.terminal.querySelector('#dispatch-mission-desc')
    if (desc) {
      desc.textContent = def.description
    }

    const steps = this.terminal.querySelector('#dispatch-mission-steps')
    if (steps) {
      steps.innerHTML = def.steps.join('<br>')
    }

    const mapLabel = this.terminal.querySelector('#dispatch-map-label')
    if (mapLabel) {
      mapLabel.textContent = def.mapLabel
    }

    this.terminal.querySelectorAll('[data-mission]').forEach(row => {
      const active = Number(row.dataset.mission) === this.selectedMission
      row.classList.toggle('selected', active)
      const marker = row.querySelector('.marker')
      if (marker) marker.textContent = active ? '>' : ' '
    })
  }

  setupMapRenderer() {
    this.mapCamera = new THREE.OrthographicCamera(
      -MAP_FRUSTUM,
      MAP_FRUSTUM,
      MAP_FRUSTUM,
      -MAP_FRUSTUM,
      1,
      800
    )
    this.mapCamera.position.set(this.mapCenter.x, 320, this.mapCenter.z)
    this.mapCamera.lookAt(this.mapCenter.x, 0, this.mapCenter.z)
    this.mapCamera.up.set(0, 0, -1)

    this.mapRenderer = new THREE.WebGLRenderer({
      canvas: this.mapCanvas,
      antialias: false,
      alpha: true,
    })
    this.mapRenderer.setPixelRatio(1)
    this.mapRenderer.setSize(MAP_RES, MAP_RES, false)
    this.mapRenderer.setClearColor(0x061408, 1)

    this.mapOverlay.width = MAP_RES
    this.mapOverlay.height = MAP_RES
  }

  setupTruckPreview() {
    const gltf = this.mainScene.getGltf('/assets/glb/blockbench-truck.glb')
    const truck = gltf.scene.clone(true)

    truck.traverse(child => {
      if (!child.isMesh) return
      child.castShadow = false
      child.receiveShadow = false
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach(material => {
        if (!material) return
        material.flatShading = true
        if (material.map) {
          material.map.minFilter = THREE.NearestFilter
          material.map.magFilter = THREE.NearestFilter
          material.map.needsUpdate = true
        }
      })
    })

    const bounds = new THREE.Box3().setFromObject(truck)
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    truck.position.sub(center)
    const maxDim = Math.max(size.x, size.y, size.z)
    truck.scale.setScalar(3.2 / maxDim)

    this.sceneTruckPreview = new THREE.Scene()
    this.sceneTruckPreview.background = new THREE.Color(0x061408)

    this.truckPivot = new THREE.Group()
    this.truckPivot.add(truck)
    this.truckPivot.position.y = 0.6
    this.sceneTruckPreview.add(this.truckPivot)

    const ambient = new THREE.AmbientLight(0x6fdc5e, 0.55)
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(4, 6, 3)
    const fill = new THREE.DirectionalLight(0x4fa844, 0.35)
    fill.position.set(-3, 2, -4)
    this.sceneTruckPreview.add(ambient, key, fill)

    this.truckCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    this.truckCamera.position.set(4.5, 3.2, 4.5)
    this.truckCamera.lookAt(0, 0, 0)

    this.truckRenderer = new THREE.WebGLRenderer({
      canvas: this.truckCanvas,
      antialias: false,
      alpha: true,
    })
    this.truckRenderer.setPixelRatio(1)
    this.truckRenderer.setSize(TRUCK_RES, TRUCK_RES, false)
    this.truckRenderer.setClearColor(0x061408, 1)

    this.truckRotation = 0
    this.truckTimerId = setInterval(() => {
      if (!this.truckRenderer) return
      this.truckRotation += TRUCK_ROTATION_SPEED * 4
      this.truckPivot.rotation.y = this.truckRotation
      this.truckRenderer.render(this.sceneTruckPreview, this.truckCamera)
    }, 16)
  }

  worldToMap(worldPos, camCenter, frustum) {
    const span = frustum * 2
    return {
      x: ((worldPos.x - camCenter.x + frustum) / span) * MAP_RES,
      y: ((worldPos.z - camCenter.z + frustum) / span) * MAP_RES,
    }
  }

  renderMap(zoomingToSpawn = false, currentFrustum = MAP_FRUSTUM, camCenter = this.mapCenter) {
    this.mapRenderer.render(this.mainScene.scene, this.mapCamera)

    const ctx = this.mapOverlay.getContext('2d')
    ctx.clearRect(0, 0, MAP_RES, MAP_RES)

    const spawnPx = this.worldToMap(this.spawnPos, camCenter, currentFrustum)
    const towerPx = this.worldToMap(this.towerPos, camCenter, currentFrustum)
    const cannonPx = this.friendlyCannonPos
      ? this.worldToMap(this.friendlyCannonPos, camCenter, currentFrustum)
      : null
    const dangerRadiusPx = (this.towerRange / (currentFrustum * 2)) * MAP_RES
    const captureRadiusPx = Math.max(5, (10 / (currentFrustum * 2)) * MAP_RES)

    if (this.selectedMission === 3 && cannonPx) {
      ctx.save()
      ctx.strokeStyle = '#ffe066'
      ctx.lineWidth = 1.6
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(spawnPx.x, spawnPx.y)
      ctx.lineTo(cannonPx.x, cannonPx.y)
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.strokeStyle = '#ff9f43'
      ctx.lineWidth = 1.6
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(cannonPx.x, cannonPx.y)
      ctx.lineTo(towerPx.x, towerPx.y)
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.strokeStyle = 'rgba(255, 198, 92, 0.95)'
      ctx.fillStyle = 'rgba(255, 198, 92, 0.2)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cannonPx.x, cannonPx.y, Math.max(7, captureRadiusPx * 1.25), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()

      ctx.fillStyle = '#4da6ff'
      ctx.fillRect(Math.round(cannonPx.x) - 4, Math.round(cannonPx.y) - 4, 8, 8)
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.strokeRect(Math.round(cannonPx.x) - 4, Math.round(cannonPx.y) - 4, 8, 8)
    } else {
      ctx.save()
      ctx.strokeStyle = '#6fdc5e'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(spawnPx.x, spawnPx.y)
      ctx.lineTo(towerPx.x, towerPx.y)
      ctx.stroke()
      ctx.restore()
    }

    if (this.selectedMission === 1) {
      ctx.save()
      ctx.strokeStyle = 'rgba(133, 232, 165, 0.95)'
      ctx.fillStyle = 'rgba(133, 232, 165, 0.22)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(towerPx.x, towerPx.y, Math.max(8, captureRadiusPx * 1.4), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    } else {
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 82, 82, 0.85)'
      ctx.fillStyle = 'rgba(255, 82, 82, 0.16)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(towerPx.x, towerPx.y, dangerRadiusPx, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }

    ctx.fillStyle = this.selectedMission === 1 ? '#85e8a5' : '#ff5252'
    ctx.fillRect(Math.round(towerPx.x) - 4, Math.round(towerPx.y) - 4, 8, 8)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(towerPx.x) - 4, Math.round(towerPx.y) - 4, 8, 8)

    ctx.fillStyle = '#ffe066'
    ctx.fillRect(Math.round(spawnPx.x) - 4, Math.round(spawnPx.y) - 4, 8, 8)
    ctx.strokeStyle = '#000'
    ctx.strokeRect(Math.round(spawnPx.x) - 4, Math.round(spawnPx.y) - 4, 8, 8)

    if (!zoomingToSpawn) {
      ctx.font = 'bold 8px monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#ffe066'
      const spawnText = this.selectedMission === 3 ? 'SPAWN + AMMO' : 'SPAWN'
      ctx.fillText(spawnText, spawnPx.x, Math.min(MAP_RES - 4, spawnPx.y + 13))

      if (this.selectedMission === 3 && cannonPx) {
        ctx.fillStyle = '#6cbfff'
        ctx.fillText('FRIENDLY TURRET', cannonPx.x, Math.max(10, cannonPx.y - 9))
      }

      ctx.fillStyle = this.selectedMission === 1 ? '#85e8a5' : '#ff8a8a'
      const towerText =
        this.selectedMission === 1
          ? 'TARGET FLAG'
          : this.selectedMission === 2
          ? 'TURRET + FLAG'
          : 'HOSTILE TURRET + FLAG'
      ctx.fillText(towerText, towerPx.x, Math.max(10, towerPx.y - 8))
    }
  }

  setMapFrustum(frustum) {
    this.mapCamera.left = -frustum
    this.mapCamera.right = frustum
    this.mapCamera.top = frustum
    this.mapCamera.bottom = -frustum
    this.mapCamera.updateProjectionMatrix()
  }

  handleKeyDown(event) {
    if (this.isTransitioning) return
    if (event.code === 'ArrowUp') {
      event.preventDefault()
      const next = ((this.selectedMission + 1) % 3) + 1
      this.selectMission(next)
    } else if (event.code === 'ArrowDown') {
      event.preventDefault()
      const next = (this.selectedMission % 3) + 1
      this.selectMission(next)
    } else if (event.code === 'Digit1') {
      this.selectMission(1)
    } else if (event.code === 'Digit2') {
      this.selectMission(2)
    } else if (event.code === 'Digit3') {
      this.selectMission(3)
    } else if (event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault()
      this.confirm()
    }
  }

  confirm() {
    this.isTransitioning = true
    trackMissionStart(this.selectedMission)
    this.root.classList.add('transitioning')
    this.root.appendChild(this.mapCanvas)
    this.root.appendChild(this.mapOverlay)
    this.mapCanvas.classList.add('zoom-out')
    this.mapOverlay.classList.add('zoom-out')
    this.mapCanvas.style.transform = ''
    this.mapOverlay.style.transform = ''
    this.mapCanvas.style.opacity = '1'
    this.mapOverlay.style.opacity = '1'

    const spawn = this.spawnPos.clone()
    const target = this.mainScene.car.chassis
    const startPos = new THREE.Vector3(this.mapCenter.x, 280, this.mapCenter.z + 0.01)
    const endPos = new THREE.Vector3()
    const lookAt = new THREE.Vector3()
    const camCenter = new THREE.Vector3()
    const startTime = performance.now()

    const dirToTower = new THREE.Vector3(
      this.towerPos.x - spawn.x,
      0,
      this.towerPos.z - spawn.z
    ).normalize()
    endPos.set(
      spawn.x - dirToTower.x * 12,
      spawn.y + 5.5,
      spawn.z - dirToTower.z * 12
    )

    const animate = () => {
      const now = performance.now()
      const t = Math.min(1, (now - startTime) / TRANSITION_MS)
      const eased = easeInOutCubic(t)

      camCenter.lerpVectors(this.mapCenter, spawn, eased)
      this.mapCamera.position.set(camCenter.x, 320, camCenter.z)
      this.mapCamera.lookAt(camCenter.x, 0, camCenter.z)

      const frustum = MAP_FRUSTUM + (MAP_FRUSTUM_END - MAP_FRUSTUM) * eased
      this.setMapFrustum(frustum)
      this.renderMap(true, frustum, camCenter)

      this.mainScene.camera.position.lerpVectors(startPos, endPos, eased)
      target.getWorldPosition(lookAt)
      this.mainScene.camera.lookAt(lookAt)

      const opacity = String(1 - Math.max(0, (eased - 0.55) / 0.45))
      this.mapCanvas.style.opacity = opacity
      this.mapOverlay.style.opacity = opacity

      if (t >= 1) {
        clearInterval(this.zoomTimerId)
        this.zoomTimerId = null
        const chosenMission = this.selectedMission
        this.dispose()
        this.onComplete(chosenMission)
      }
    }

    this.mainScene.camera.position.copy(startPos)
    this.mainScene.camera.lookAt(spawn)
    this.zoomTimerId = setInterval(animate, 16)
  }

  dispose() {
    document.removeEventListener('keydown', this.keyHandler)
    document.body.classList.remove('dispatch-active')
    if (this.truckTimerId) clearInterval(this.truckTimerId)
    if (this.zoomTimerId) clearInterval(this.zoomTimerId)
    this.truckRenderer?.dispose()
    this.truckRenderer = null
    this.mapRenderer.dispose()
    this.root.remove()
  }
}
