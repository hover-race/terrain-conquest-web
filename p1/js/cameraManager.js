import * as THREE from 'three'
import { RTSCamera } from './rtsCam.js'
import { setupCamera } from './followCam.js'
import { isUiEvent } from './gameInput.js'

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class CameraManager {
  scene
  vehicle
  controllers = []
  mainCamera
  gunCamera
  currentIndex = 0

  isTransitioning = false
  transitionProgress = 1
  transitionDuration = 0.42
  transitionFromPos = new THREE.Vector3()
  transitionFromQuat = new THREE.Quaternion()
  transitionFromFov = 75
  targetPos = new THREE.Vector3()
  targetQuat = new THREE.Quaternion()
  boundKeyListener = null

  constructor(scene, vehicle, mainCamera) {
    this.scene = scene
    this.vehicle = vehicle
    this.mainCamera = mainCamera
    this.mainCamera.near = 0.08
    this.mainCamera.updateProjectionMatrix()

    this.initializeCameras()
    this.setupKeyListener()
  }

  initializeCameras() {
    const rtsCamera = new RTSCamera(this.mainCamera, this.vehicle.chassis, this.vehicle, this.scene)
    const followCameraController = setupCamera(
      this.mainCamera,
      this.vehicle.chassis,
      this.vehicle,
      this.scene
    )
    const gunCameraController = this.vehicle.gunCamera

    this.controllers = [
      rtsCamera,
      followCameraController,
      gunCameraController,
    ]

    this.gunCamera = gunCameraController.camera
    this.controllers[this.currentIndex].activate()
  }

  isGunCameraActive() {
    return this.controllers[this.currentIndex] === this.vehicle.gunCamera
  }

  setupKeyListener() {
    this.boundKeyListener = e => {
      if (e.code === 'KeyC' && !e.repeat && !isUiEvent(e)) {
        this.switchCameraMode()
      }
    }
    document.addEventListener('keydown', this.boundKeyListener)
  }

  switchCameraMode({ instant = false } = {}) {
    if (this.controllers.length === 0) return

    this.mainCamera.updateMatrixWorld(true)
    this.transitionFromPos.copy(this.mainCamera.position)
    this.transitionFromQuat.copy(this.mainCamera.quaternion)
    this.transitionFromFov = this.mainCamera.fov

    if (this.controllers[this.currentIndex]) {
      this.controllers[this.currentIndex].deactivate()
    }

    this.currentIndex = (this.currentIndex + 1) % this.controllers.length

    const newController = this.controllers[this.currentIndex]
    newController.activate()
    this.scene.setActiveCamera(this.mainCamera)

    if (instant) {
      this.isTransitioning = false
      this.transitionProgress = 1
      newController.update(0.016)
    } else {
      this.isTransitioning = true
      this.transitionProgress = 0
      this.mainCamera.position.copy(this.transitionFromPos)
      this.mainCamera.quaternion.copy(this.transitionFromQuat)
      this.mainCamera.fov = this.transitionFromFov
      this.mainCamera.updateProjectionMatrix()
    }
  }

  update(deltaTime) {
    const dt =
      deltaTime > 1 ? Math.min(deltaTime / 1000, 0.1) : Math.min(Math.max(deltaTime || 0.016, 0.001), 0.1)

    const activeController = this.controllers[this.currentIndex]
    if (activeController) {
      activeController.update(dt)
    }

    if (this.isTransitioning) {
      this.transitionProgress = Math.min(1, this.transitionProgress + dt / this.transitionDuration)
      const eased = easeInOutCubic(this.transitionProgress)

      this.targetPos.copy(this.mainCamera.position)
      this.targetQuat.copy(this.mainCamera.quaternion)
      const targetFov = this.mainCamera.fov

      this.mainCamera.position.lerpVectors(this.transitionFromPos, this.targetPos, eased)
      this.mainCamera.quaternion.slerpQuaternions(this.transitionFromQuat, this.targetQuat, eased)
      this.mainCamera.fov = THREE.MathUtils.lerp(this.transitionFromFov, targetFov, eased)
      this.mainCamera.updateProjectionMatrix()

      if (this.transitionProgress >= 1) {
        this.isTransitioning = false
      }
    }
  }

  dispose() {
    if (this.boundKeyListener) {
      document.removeEventListener('keydown', this.boundKeyListener)
      this.boundKeyListener = null
    }
    this.controllers.forEach(controller => {
      if (controller && controller.dispose) {
        controller.dispose()
      }
    })
  }
}
