import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ProjectileSystem, WEAPONS } from './projectileSystem.js'
import { ProjectileEffects } from './projectileEffects.js'
import { RedTrailPass } from './redTrailPass.js'

const $ = id => document.getElementById(id)
const FIXED_STEP = 1 / 120
let renderer
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
} catch (error) {
  $('error').hidden = false
  $('error').textContent = 'The firing range needs WebGL. Enable hardware acceleration in your browser and reload.'
  throw error
}
// Default to native CSS resolution; High DPI is available for A/B comparisons.
renderer.setPixelRatio(1)
renderer.info.autoReset = false
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
document.body.prepend(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x777d75)
scene.fog = new THREE.FogExp2(0x777d75, 0.009)
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 350)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.485
controls.minDistance = 5
controls.maxDistance = 115
function resetView() {
  camera.position.set(34, 22, 36)
  controls.target.set(0, 1.5, -15)
  controls.update()
}
resetView()
scene.add(new THREE.HemisphereLight(0xd3e3e0, 0x716146, 2.3))
const sun = new THREE.DirectionalLight(0xffdbab, 3)
sun.position.set(-30, 45, -10)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, far: 150 })
sun.shadow.normalBias = 0.035
scene.add(sun)
const materials = {
  sand: new THREE.MeshStandardMaterial({ color: 0x968771, roughness: 1 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x686e65, roughness: 0.95 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x28312f, roughness: 0.65, metalness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x5b6258, roughness: 0.48, metalness: 0.7 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x5e6244, roughness: 0.7, metalness: 0.4 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc29a55, roughness: 0.5, metalness: 0.6 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xdbb16b, roughness: 0.9 }),
}
const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
function box(parent, material, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(boxGeometry, material)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}
function cylinder(parent, material, radius, length, x, y, z, alongZ = false) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), material)
  mesh.position.set(x, y, z)
  if (alongZ) mesh.rotation.x = Math.PI / 2
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}
function label(text, position, width = 5, color = '#dfcfab') {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#293633'; ctx.fillRect(0, 0, 512, 128)
  ctx.strokeStyle = '#a89b72'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, 502, 118)
  ctx.fillStyle = color; ctx.font = `500 ${text.length > 20 ? 28 : 42}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
  mesh.position.copy(position)
  scene.add(mesh)
  return mesh
}
box(scene, materials.sand, 0, -0.3, -30, 260, 0.6, 260)
box(scene, materials.concrete, 0, 0.05, 7, 24, 0.1, 13)
for (const x of [-12, -4, 4, 12]) box(scene, materials.stripe, x, 0.025, -21, 0.07, 0.05, 66)
for (const z of [-8, -22, -36, -50]) {
  box(scene, materials.stripe, 0, 0.03, z, 24, 0.06, 0.09)
  label(`${10 - z} m`, new THREE.Vector3(14, 1, z), 2.5)
}
box(scene, materials.concrete, 0, 3, -57, 33, 6, 2)
for (const x of [-16, 16]) box(scene, materials.concrete, x, 0.7, -24, 0.6, 1.4, 68)
label('BALLISTICS / TEST RANGE', new THREE.Vector3(0, 5, -55.9), 12)
label('01 / ORIGINAL MG', new THREE.Vector3(-8, 0.7, 12.5), 4.5)
label('03 / RED MG', new THREE.Vector3(0, 0.7, 12.5), 4.5)
label('02 / ROCKET', new THREE.Vector3(8, 0.7, 12.5), 4.5)
// Low, faceted dunes keep the range grounded without external assets.
const duneGeometry = new THREE.IcosahedronGeometry(1, 1)
for (let i = 0; i < 38; i++) {
  const angle = i / 38 * Math.PI * 2
  const dune = new THREE.Mesh(duneGeometry, materials.sand)
  dune.position.set(Math.cos(angle) * (80 + Math.random() * 25), -2, -20 + Math.sin(angle) * 85)
  dune.scale.set(15 + Math.random() * 20, 5 + Math.random() * 10, 14 + Math.random() * 20)
  scene.add(dune)
}
for (const x of [-10, 10]) {
  for (let i = 0; i < 3; i++) box(scene, materials.olive, x, 0.4 + i * 0.65, 8, 1.4, 0.6, 1)
}

function makeWeapon(type, x) {
  const base = new THREE.Group()
  base.position.set(x, 0, 7)
  scene.add(base)
  cylinder(base, materials.dark, 0.65, 0.2, 0, 0.15, 0)
  cylinder(base, materials.steel, 0.13, 1.65, 0, 0.9, 0)
  for (let i = 0; i < 3; i++) {
    const leg = box(base, materials.dark, 0, 0.45, 0, 0.13, 1.2, 0.13)
    leg.rotation.z = 0.8
    const pivot = new THREE.Group(); base.add(pivot); pivot.rotation.y = i * Math.PI * 2 / 3; pivot.add(leg)
    leg.position.x = 0.45
  }
  const pivot = new THREE.Group(); pivot.position.y = 1.9; base.add(pivot)
  const body = new THREE.Group(); pivot.add(body)
  const recoilPart = type === 'rocket' ? body : new THREE.Group()
  if (recoilPart !== body) body.add(recoilPart)
  if (type !== 'rocket') {
    box(body, materials.dark, 0, 0, 0, 0.45, 0.45, 1.4)
    box(body, materials.olive, 0, -0.1, 1, 0.3, 0.4, 0.85)
    box(body, materials.olive, -0.48, -0.2, 0.05, 0.55, 0.6, 0.7)
    cylinder(recoilPart, materials.steel, 0.09, 1.8, 0, 0.08, -1.45, true)
    cylinder(recoilPart, materials.dark, 0.14, 0.28, 0, 0.08, -2.32, true)
    for (let i = 0; i < 8; i++) cylinder(recoilPart, materials.dark, 0.125, 0.055, 0, 0.08, -0.7 - i * 0.16, true)
    for (let i = 0; i < 6; i++) cylinder(body, materials.gold, 0.045, 0.26, -0.27 - i * 0.075, 0.13, 0.03, true)
    box(body, materials.dark, 0, 0.32, -0.4, 0.1, 0.25, 0.15)
  } else {
    cylinder(body, materials.olive, 0.32, 2.6, 0, 0, 0, true)
    cylinder(body, materials.dark, 0.37, 0.2, 0, 0, -1.3, true)
    cylinder(body, materials.dark, 0.38, 0.25, 0, 0, 1.3, true)
    cylinder(body, materials.dark, 0.265, 0.015, 0, 0, -1.41, true)
    box(body, materials.dark, 0.4, 0.25, -0.1, 0.14, 0.2, 0.8)
    box(body, materials.dark, 0, -0.45, 0.3, 0.16, 0.6, 0.3)
    for (const z of [-0.8, 0.8]) cylinder(body, materials.gold, 0.33, 0.12, 0, 0, z, true)
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, type !== 'rocket' ? 0.08 : 0, type !== 'rocket' ? -2.5 : -1.55); recoilPart.add(muzzle)
  return { type, base, pivot, body, recoilPart, muzzle, recoil: 0, previousRecoil: 0, targetIndex: 0 }
}
const weapons = { machineGun: makeWeapon('machineGun', -8), machineGunRed: makeWeapon('machineGunRed', 0), rocket: makeWeapon('rocket', 8) }
const weaponNames = { machineGun: 'MACHINE GUN / ORIGINAL', machineGunRed: 'MACHINE GUN / RED', rocket: 'ROCKET LAUNCHER' }
let targets = []
let selected = 'machineGun'
let firing = false
let simTime = 0
const effects = new ProjectileEffects(scene)
const redTrails = new RedTrailPass(renderer)
let trailsEnabled = true
const tracerGeometry = new THREE.CylinderGeometry(0.026, 0.026, 1, 8)
tracerGeometry.rotateX(Math.PI / 2)
const tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffde95, toneMapped: false })
const redTracerMaterial = new THREE.MeshBasicMaterial({ color: 0xff2424, toneMapped: false })
const rocketGeometry = new THREE.ConeGeometry(0.15, 0.9, 10)
rocketGeometry.rotateX(Math.PI / 2)
const visuals = new Map()
const freeVisuals = Object.fromEntries(Object.keys(WEAPONS).map(type => [type, []]))
const system = new ProjectileSystem({
  onFire(p) {
    const mesh = freeVisuals[p.type].pop() || new THREE.Mesh(p.type === 'rocket' ? rocketGeometry : tracerGeometry, p.type === 'rocket' ? materials.olive : p.type === 'machineGunRed' ? redTracerMaterial : tracerMaterial)
    mesh.position.copy(p.position)
    mesh.lookAt(p.position.clone().add(p.velocity))
    if (p.type === 'machineGun') mesh.scale.set(1, 1, 1.8)
    if (p.type === 'machineGunRed') mesh.scale.set(0.09 / 0.026, 0.09 / 0.026, 2.6)
    scene.add(mesh); visuals.set(p, mesh)
    effects.flash(p.position, p.type === 'rocket')
    weapons[p.type].recoil = 0.18
    p.trailTime = 0
  },
  onMove(p, dt) {
    if (trailsEnabled && p.type === 'machineGunRed') redTrails.add(p.previous, p.position, FIXED_STEP)
    const mesh = visuals.get(p)
    mesh.position.copy(p.position)
    mesh.lookAt(p.position.clone().add(p.velocity))
    p.trailTime += dt
    const spacing = p.type === 'rocket' ? 0.025 : 0.03
    while (p.trailTime >= spacing) {
      p.trailTime -= spacing
      if (p.type === 'rocket') {
        effects.emit(p.position, { color: 0xffe6ac, size: 1.4, life: 0.09 })
        effects.emit(p.position, { color: 0xbab3a1, smoke: true, size: 0.4, endSize: 2.4, life: 1.8, opacity: 0.32, velocity: new THREE.Vector3(0.5, 0.6, 0) })
      } else if (p.type === 'machineGun') effects.emit(p.position, { color: 0xffc477, size: 0.45, life: 0.075 })
    }
  },
  onImpact(p, target) {
    if (trailsEnabled && p.type === 'machineGunRed') redTrails.add(p.previous, p.position, FIXED_STEP)
    if (p.type === 'rocket') effects.impact2(p.position)
    else effects.impact1(p.position)
    if (target?.mesh) { target.flash = 1; target.mesh.material.emissive.setHex(0xff963c) }
  },
  onRemove(p) {
    const mesh = visuals.get(p)
    if (mesh) { scene.remove(mesh); freeVisuals[p.type].push(mesh); visuals.delete(p) }
  },
})
const targetGeometry = new THREE.BoxGeometry(2.4, 2.6, 0.2)
const targetTextureCanvas = document.createElement('canvas')
targetTextureCanvas.width = targetTextureCanvas.height = 256
const targetCtx = targetTextureCanvas.getContext('2d')
targetCtx.fillStyle = '#cbc5ac'; targetCtx.fillRect(0, 0, 256, 256)
for (let i = 4; i > 0; i--) {
  targetCtx.beginPath(); targetCtx.arc(128, 128, i * 26, 0, Math.PI * 2)
  targetCtx.fillStyle = i % 2 ? '#c8834b' : '#34413c'; targetCtx.fill()
}
const targetTexture = new THREE.CanvasTexture(targetTextureCanvas)
targetTexture.colorSpace = THREE.SRGBColorSpace
const targetGroup = new THREE.Group(); scene.add(targetGroup)
function generate() {
  system.reset(); effects.clear(); redTrails.clear(); simTime = 0
  for (const target of targets) target.mesh.material.dispose()
  targetGroup.clear()
  targets = []
  const layout = Array.from({ length: 3 }, (_, i) => ({ x: (i - 1) * 1.8 + (Math.random() - 0.5) * 0.7, z: -13 - i * 15 + (Math.random() - 0.5) * 3, y: 2.5 + Math.random() * 0.6 }))
  for (const [type, weapon] of Object.entries(weapons)) {
    weapon.targetIndex = 0
    weapon.shots = 0
    weapon.recoil = weapon.previousRecoil = 0
    weapon.recoilPart.position.z = 0
    for (let i = 0; i < 3; i++) {
      const x = weapon.base.position.x + layout[i].x
      const z = layout[i].z
      const y = layout[i].y
      const material = new THREE.MeshStandardMaterial({ map: targetTexture, roughness: 0.65, metalness: 0.3 })
      const mesh = new THREE.Mesh(targetGeometry, material)
      mesh.position.set(x, y, z); mesh.castShadow = true; targetGroup.add(mesh)
      box(targetGroup, materials.dark, x, y / 2, z + 0.15, 0.15, y, 0.15)
      box(targetGroup, materials.concrete, x, 0.13, z, 2.8, 0.26, 1.4)
      mesh.updateMatrixWorld()
      targets.push({ type, mesh, box: new THREE.Box3().setFromObject(mesh), flash: 0, scoring: true })
    }
  }
  system.targets = [...targets, { box: new THREE.Box3(new THREE.Vector3(-16.5, 0, -58), new THREE.Vector3(16.5, 6, -56)), scoring: false }]
}
generate()
const muzzle = new THREE.Vector3()
const direction = new THREE.Vector3()
function shoot(weapon) {
  const candidates = targets.filter(t => t.type === weapon.type)
  const target = candidates[weapon.targetIndex % candidates.length]
  weapon.pivot.lookAt(target.mesh.position)
  // Weapon models point along -Z; Object3D.lookAt points +Z toward the target.
  weapon.pivot.rotateY(Math.PI)
  weapon.pivot.updateMatrixWorld(true)
  weapon.muzzle.getWorldPosition(muzzle)
  direction.subVectors(target.mesh.position, muzzle).normalize()
  if (weapon.type !== 'rocket') {
    direction.x += (Math.random() - 0.5) * 0.012
    direction.y += (Math.random() - 0.5) * 0.012
  }
  const p = system.fire(weapon.type, muzzle, direction)
  if (p) {
    weapon.shots++
    if ($('demo').checked && (weapon.type === 'rocket' || weapon.shots % 12 === 0)) weapon.targetIndex++
  }
}
function select(type) {
  selected = type
  for (const button of document.querySelectorAll('[data-weapon]')) {
    const active = button.dataset.weapon === type
    button.classList.toggle('selected', active)
    button.setAttribute('aria-pressed', String(active))
  }
}
for (const button of document.querySelectorAll('[data-weapon]')) button.addEventListener('click', () => select(button.dataset.weapon))
select(selected)
$('generate').addEventListener('click', generate)
$('slow').addEventListener('change', () => { $('speed-label').textContent = $('slow').checked ? '0.2×' : '1×' })
$('glow').addEventListener('input', () => { effects.intensity = Number($('glow').value); $('glow-label').textContent = `${Math.round(effects.intensity * 100)}%` })
const rangeFog = scene.fog
function resetFpsSample() {
  fpsFrames = 0
  fpsStart = performance.now()
  fpsDisplay.textContent = '—'
}
function featureToggle(id, apply) {
  $(id).addEventListener('change', event => {
    apply(event.target.checked)
    resetFpsSample()
  })
}
featureToggle('perf-fog', enabled => { scene.fog = enabled ? rangeFog : null })
featureToggle('perf-shadows', enabled => { renderer.shadowMap.enabled = enabled })
featureToggle('perf-particles', enabled => { effects.enabled = enabled })
featureToggle('perf-smoke', enabled => { effects.smokeEnabled = enabled })
featureToggle('perf-lights', enabled => {
  effects.lightsEnabled = enabled
  for (const light of effects.lights) { light.visible = enabled; light.intensity = 0 }
})
featureToggle('perf-trails', enabled => {
  trailsEnabled = enabled
  redTrails.clear()
})
featureToggle('perf-hidpi', enabled => {
  renderer.setPixelRatio(enabled ? Math.min(devicePixelRatio, 2) : 1)
  renderer.setSize(innerWidth, innerHeight)
  redTrails.resize()
})
function startFire() { firing = true; $('demo').checked = false }
$('fire').addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); $('fire').setPointerCapture(e.pointerId); startFire() })
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('fire').addEventListener(event, () => { firing = false })
window.addEventListener('keydown', e => {
  if (e.target.closest('input,a,select,textarea,[contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.code === 'Space') {
    if (e.target.closest('button') && e.target !== $('fire')) return
    e.preventDefault(); startFire()
  }
  if (e.repeat) return
  if (e.code === 'Digit1') select('machineGun')
  if (e.code === 'Digit2') select('rocket')
  if (e.code === 'Digit3') select('machineGunRed')
  if (e.code === 'KeyG') generate()
  if (e.code === 'KeyR') resetView()
})
window.addEventListener('keyup', e => { if (e.code === 'Space') firing = false })
window.addEventListener('blur', () => { firing = false })
document.addEventListener('visibilitychange', () => {
  firing = false
  accumulator = 0
  clock.getDelta()
  fpsFrames = 0
  fpsStart = performance.now()
  fpsDisplay.textContent = '—'
})
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let down = null
renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY } })
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return }
  down = null
  pointer.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects(targets.map(t => t.mesh))[0]
  if (hit) {
    const target = targets.find(t => t.mesh === hit.object)
    select(target.type)
    weapons[target.type].targetIndex = targets.filter(t => t.type === target.type).indexOf(target)
    $('demo').checked = false
  }
})
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  redTrails.resize()
})
const clock = new THREE.Clock()
let accumulator = 0
const fpsDisplay = $('fps')
let fpsFrames = 0
let fpsStart = performance.now()
function animate() {
  // Real rendering rate: unaffected by simulation slow motion or the dt cap.
  if (!document.hidden) {
    fpsFrames++
    const now = performance.now()
    const elapsed = now - fpsStart
    if (elapsed >= 500) {
      fpsDisplay.textContent = String(Math.round(fpsFrames * 1000 / elapsed))
      $('perf-stats').textContent = `${(elapsed / fpsFrames).toFixed(1)} ms/frame · ${renderer.info.render.calls} draw calls\n${effects.active.length} particles · ${renderer.domElement.width}×${renderer.domElement.height} px`
      fpsFrames = 0
      fpsStart = now
    }
  }
  const dt = Math.min(clock.getDelta(), 0.1)
  if (!document.hidden) accumulator += dt * ($('slow').checked ? 0.2 : 1)
  while (accumulator >= FIXED_STEP) {
    const step = FIXED_STEP
    for (const weapon of Object.values(weapons)) {
      weapon.previousRecoil = weapon.recoil
      weapon.recoilPart.position.z = weapon.recoil
    }
    simTime += step
    redTrails.update(step)
    system.update(step)
    if ($('demo').checked) {
      if (simTime % 2.5 < 1.7) {
        shoot(weapons.machineGun)
        shoot(weapons.machineGunRed)
      }
      shoot(weapons.rocket)
    } else if (firing) shoot(weapons[selected])
    for (const weapon of Object.values(weapons)) {
      weapon.recoil *= Math.exp(-25 * step)
      weapon.recoilPart.position.z = weapon.recoil
    }
    for (const target of targets) {
      target.flash *= Math.exp(-8 * step)
      target.mesh.material.emissiveIntensity = target.flash * 2
    }
    effects.update(step)
    accumulator -= step
  }
  // Render between the two latest simulation states without changing collisions.
  const alpha = accumulator / FIXED_STEP
  for (const [projectile, mesh] of visuals) {
    mesh.position.lerpVectors(projectile.previous, projectile.position, alpha)
  }
  for (const weapon of Object.values(weapons)) {
    weapon.recoilPart.position.z = THREE.MathUtils.lerp(weapon.previousRecoil, weapon.recoil, alpha)
  }
  controls.update()
  $('shots').textContent = String(system.shots).padStart(4, '0')
  $('hits').textContent = String(system.hits).padStart(4, '0')
  $('active').textContent = String(system.projectiles.length).padStart(2, '0')
  $('status').textContent = $('demo').checked ? 'AUTO FIRING · BOTH MG VARIANTS + ROCKET' : `${firing ? 'FIRING' : 'READY'} · ${weaponNames[selected]}`
  renderer.info.reset()
  if (trailsEnabled) redTrails.render(scene, camera, effects.intensity, accumulator - FIXED_STEP)
  else renderer.render(scene, camera)
}
renderer.setAnimationLoop(animate)
