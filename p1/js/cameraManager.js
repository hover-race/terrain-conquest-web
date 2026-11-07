import { RTSCamera } from './rtsCam.js';
import { setupCamera } from './followCam.js';

export class CameraManager {
  scene; // Main scene reference
  vehicle; // Vehicle reference
  
  // Camera controllers array
  controllers = [];
  
  // Camera objects
  mainCamera; // The original scene camera
  gunCamera; // The gun camera's own camera instance
  // mainCamera is moved around by the controllers (rtsCam, followCam)
  // Gun camera is parented to the vehicle.
  // gunCameraController moves the turret
  
  // State
  currentIndex = 0; // Index into controllers array
  
  constructor(scene, vehicle, mainCamera) {
    this.scene = scene;
    this.vehicle = vehicle;
    this.mainCamera = mainCamera;
    
    this.initializeCameras();
    this.setupKeyListener();
  }
  
  initializeCameras() {
    // Create camera controllers and add to array
    const rtsCamera = new RTSCamera(this.mainCamera, this.vehicle.chassis, this.vehicle, this.scene);
    const followCameraController = setupCamera(this.mainCamera, this.vehicle.chassis, this.vehicle, this.scene);
    const gunCameraController = this.vehicle.gunCamera;
    
    this.controllers = [
      rtsCamera,           // Index 0: RTS Camera
      followCameraController, // Index 1: Follow Camera
      gunCameraController    // Index 2: Gun Camera
    ];
    
    this.gunCamera = gunCameraController.camera;
    
    // Activate initial camera mode (RTS)
    this.controllers[this.currentIndex].activate();
    
    console.log("CameraManager initialized with RTS camera active");
  }
  
  setupKeyListener() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') {
        this.switchCameraMode();
      }
    });
  }
  
  switchCameraMode() {
    if (this.controllers.length === 0) {
      console.warn("Cannot switch camera mode: no controllers available");
      return;
    }
    
    // Deactivate current camera
    if (this.controllers[this.currentIndex]) {
      this.controllers[this.currentIndex].deactivate();
    }
    
    // Switch to next controller
    this.currentIndex = (this.currentIndex + 1) % this.controllers.length;
    
    // Activate new camera - all controllers now have unified interface
    const newController = this.controllers[this.currentIndex];
    newController.activate();
    
    console.log(`Switched to camera mode ${this.currentIndex}`);
    
    // Update scene's active camera using the scene's method
    this.scene.setActiveCamera(this.scene.camera);
  }
  
  update(deltaTime) {
    // Update the active camera controller - all controllers now have unified interface
    const activeController = this.controllers[this.currentIndex];
    if (activeController) {
      activeController?.update(deltaTime);
    }
  }
  
  dispose() {
    // Clean up all camera controllers
    this.controllers.forEach(controller => {
      if (controller && controller.dispose) {
        controller.dispose();
      }
    });
    
    // Remove key listener (would need to store bound function to remove properly)
    console.log("CameraManager disposed");
  }
} 