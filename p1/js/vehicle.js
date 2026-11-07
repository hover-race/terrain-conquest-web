import { createMuzzleFlash } from './particles.js'
import { playExplosionSound } from './sounds.js'
import { Bullet } from './bullet.js'
import { findNodesByPrefix, findSingleNode } from './util.js'
import { GunCamera } from './gunCamera.js'
import { isUiEvent } from './gameInput.js'

export class Vehicle {
  vehicle
  tuning
  chassis
  wheelMeshes = {} // Object with named wheel properties
  turretTraverseAxis
  bulletOrigin
  RTS_camera_pos
  turret // Add reference to the VehicleTurret instance
  
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
    this.gunCamera = new GunCamera(this.scene, this.gunCameraPos, this)

    this.wheelMeshes = {
      frontLeft: findSingleNode(carScene, 'wheel_FL'),
      frontRight: findSingleNode(carScene, 'wheel_FR'),
      rearLeft: findSingleNode(carScene, 'wheel_RL'),
      rearRight: findSingleNode(carScene, 'wheel_RR')
    }

    if (!this.chassis || !this.wheelMeshes.frontLeft || !this.wheelMeshes.frontRight || !this.wheelMeshes.rearLeft || !this.wheelMeshes.rearRight) {
      throw new Error('Could not find all required truck parts (body, wheel_..., etc.) in GLTF.')
    }

    this.hitch = findSingleNode(carScene, 'hitch')
    if (this.hitch.parent !== this.chassis) {
      const local = this.hitch.position.clone()
      this.chassis.add(this.hitch)
      this.hitch.position.copy(local)
    }
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
    const wheelArray = [this.wheelMeshes.frontLeft, this.wheelMeshes.frontRight, this.wheelMeshes.rearLeft, this.wheelMeshes.rearRight]
    
    for (i = 0; i < n; i++) {
    //   this.vehicle.updateWheelTransform(i, true) // This might cause jitter, but often needed
      tm = this.vehicle.getWheelTransformWS(i)
      p = tm.getOrigin()
      q = tm.getRotation()
      if (wheelArray[i]) {
        wheelArray[i].position.set(p.x(), p.y(), p.z())
        wheelArray[i].quaternion.set(q.x(), q.y(), q.z(), q.w())
        // Optional rotation fix if wheels are modeled sideways
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
    // Use the wheelMesh's position relative to the chassis
    const pos = new Ammo.btVector3(wheelMesh.position.x, wheelMesh.position.y, wheelMesh.position.z)

    var suspensionStiffness = 50.0
    var suspensionDampingRelaxation = 2.3 // Renamed from suspensionDamping in original
    var suspensionDampingCompression = 4.4
    var suspensionRestLength = 0.0 // Adjusted from 0, should be distance from chassis connection to wheel center
    var maxSuspensionTravelCm = 500 // From reference

    this.tuning.set_m_maxSuspensionTravelCm(maxSuspensionTravelCm); // Use setter if available, check Ammo.js version

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

    wheelInfo.set_m_frictionSlip(1.5) // Value from reference
    wheelInfo.set_m_rollInfluence(0.5) // Adjusted, reference had 1 but might be too much
  }

  createMinimapSprite() {
    // Create canvas texture for triangle
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, 64, 64);
    
    // Draw red triangle (arrow pointing up)
    ctx.fillStyle = '#ff0000';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(32, 8);   // Top point
    ctx.lineTo(16, 48);  // Bottom left
    ctx.lineTo(48, 48);  // Bottom right
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    // Create plane geometry and material instead of sprite
    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide
    });
    
    const SCALE = 60;
    // Create plane mesh instead of sprite
    this.minimapSprite = new THREE.Mesh(planeGeometry, planeMaterial);
    this.minimapSprite.scale.set(SCALE, SCALE, 1);
    this.minimapSprite.layers.set(1); // Put on minimap layer
    this.minimapSprite.position.set(0, 5, 0); // Position above chassis center
    this.minimapSprite.rotation.x = -Math.PI / 2; // Rotate to face up (like a decal on ground)
    this.minimapSprite.rotation.z = Math.PI; // Flip triangle 180 degrees
    
    // Attach to chassis
    this.chassis.add(this.minimapSprite);
  }
}

class VehicleTurret {
  turretVerticalAxis
  bulletOrigin
  raycaster = new THREE.Raycaster()
  mainScene = null
  vehicle = null
  lastShotTime = 0; // Timestamp of the last shot
  shootCooldownSec = 0.4
  isShooting = false; // Flag for continuous shooting

  constructor(turretVerticalAxis, bulletOrigin, vehicle) {
    this.turretVerticalAxis = turretVerticalAxis
    this.bulletOrigin = bulletOrigin
    this.vehicle = vehicle

    window.pubsub.addEventListener('update', (e) => {
      this.mainScene = e.detail.mainScene // Store mainScene
      this.update(e.detail.mainScene, e.detail.mouseCoords)
    })

    // Add mouse listeners for shooting
    document.addEventListener('mousedown', (event) => {
      if (event.defaultPrevented || isUiEvent(event) || !this.vehicle.scene.gameStarted) return
      // Check for Left Mouse Button (button 0)
      if (event.button === 0) {
        this.isShooting = true;
      }
    });

    document.addEventListener('mouseup', (event) => {
      // Check for Left Mouse Button (button 0)
      if (event.button === 0) {
        this.isShooting = false;
      }
    });

    window.addEventListener('blur', () => {
      this.isShooting = false;
    });

  }

  // Extracted turret aiming logic that can be called from camera controllers
  aimTurret(mainScene, mouseCoords) {
    if (!mouseCoords || !mainScene || !mainScene.camera) {
      console.warn('Cannot aim turret: Missing mouseCoords or camera.');
      return;
    }

    this.raycaster.setFromCamera(mouseCoords, mainScene.camera);

    const objectsToIntersect = mainScene.scene.children.filter(obj => obj !== mainScene.car.chassis);
    const intersects = this.raycaster.intersectObjects(objectsToIntersect, true);

    if (intersects.length > 0) {
      const intersectionPoint = intersects[0].point;
      const targetPoint = intersectionPoint.clone();
      const turretWorldPosition = new THREE.Vector3();
      this.turretVerticalAxis.getWorldPosition(turretWorldPosition);
      // targetPoint.y = turretWorldPosition.y
      this.turretVerticalAxis.lookAt(targetPoint);
    }
  }

  shoot() {
    const currentTime = Date.now();
    if (currentTime - this.lastShotTime < this.shootCooldownSec * 1000) {
      // console.log("Shoot on cooldown");
      return; // Cooldown active, do not shoot
    }

    if (!this.mainScene) {
      console.warn("Cannot shoot: mainScene context not available in Turret.");
      return;
    }

    const turretCenterPosition = new THREE.Vector3();
    this.turretVerticalAxis.getWorldPosition(turretCenterPosition);

    createMuzzleFlash(this.mainScene, this.bulletOrigin, turretCenterPosition);
    playExplosionSound(); // Play the new explosion sound

    this.lastShotTime = currentTime; // Update last shot time

    // Create a new Bullet instance
    new Bullet(this.mainScene, this.bulletOrigin); // Assuming shootSpeed of 100

    // Apply recoil to the vehicle
    // Need to get direction again as Bullet constructor might have modified it if passed by reference
    const directionForRecoil = new THREE.Vector3();
    this.bulletOrigin.getWorldDirection(directionForRecoil);

    const recoilMagnitude = 500// guiState.recoilMagnitude;
    const recoilImpulse = directionForRecoil.clone().multiplyScalar(-recoilMagnitude);
    const vehicleBody = this.vehicle.chassis.body.ammo;
    
    const worldPos = new THREE.Vector3();
    this.bulletOrigin.getWorldPosition(worldPos);
    const localPos = this.vehicle.chassis.worldToLocal(worldPos);
    const ammoLocalPos = new Ammo.btVector3(localPos.x, localPos.y, localPos.z);
    const ammoRecoil = new Ammo.btVector3(recoilImpulse.x, recoilImpulse.y, recoilImpulse.z);

    const DEBUG = 0;
    if (DEBUG) {
      console.log("recoilImpulse", recoilImpulse);
      console.log("ammoRecoil", [ammoRecoil.x(), ammoRecoil.y(), ammoRecoil.z()]);
    }

    vehicleBody.applyImpulse(ammoRecoil, ammoLocalPos);
    vehicleBody.activate();
  }

  update(mainScene, mouseCoords) {
    // Continuous shooting logic (always enabled)
    if (this.isShooting) {
      this.shoot();
    }
   
  }
}
