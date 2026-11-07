import { guiState } from './gui.js';

export class GunCamera {
  camera; // The gun camera instance (our own camera)
  parentNode; // The THREE.Object3D to parent the camera under (the Scope node from vehicle)
  scene; // Scene reference to swap cameras
  vehicle; // Vehicle reference to access turret

  // Configuration
  offsetDistance = 0.2; // Distance behind the scope
  offsetHeight = 0.05; // Small height offset from scope position
  
  // Turret control
  lastMouseX = 0;
  lastMouseY = 0;
  boundHandleMouseMove; // Store bound function for removal
  boundHandleMouseClick; // Store bound function for click handling
  boundHandleMouseWheel; // Store bound function for zoom handling
  isPointerLocked = false; // Track pointer lock state
  
  // Zoom system
  zoomLevels = [1, 2, 5]; // Available zoom levels
  currentZoomIndex = 0; // Index into zoomLevels array
  baseFOV = 75; // Base field of view
  
  // State
  isActive = false; // Track if this camera is active
  originalCamera = null; // Store the original scene camera

  constructor(scene, parentNode, vehicle) {
    this.scene = scene;
    this.parentNode = parentNode;
    this.vehicle = vehicle;
    
    // Create our own camera
    this.camera = new THREE.PerspectiveCamera(
      this.baseFOV, // Use base FOV initially
      window.innerWidth / window.innerHeight, // aspect ratio
      0.1, // near
      5000 // far - match main camera's far plane to see sky sphere (radius 2000)
    );

    // Parent camera to scope node immediately - it stays there permanently
    this.parentNode.add(this.camera);
    
    // Position camera relative to scope
    this.camera.position.set(0, this.offsetHeight, -this.offsetDistance);
    this.camera.rotation.set(0, 0, 0); // Reset rotation, it will inherit from parent

    // Bind event handlers
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseClick = this.handleMouseClick.bind(this);
    this.boundHandlePointerLockChange = this.handlePointerLockChange.bind(this);
    this.boundHandlePointerLockError = this.handlePointerLockError.bind(this);
    this.boundHandleMouseWheel = this.handleMouseWheel.bind(this);
  }

  // Handle pointer lock state changes (when browser automatically exits lock)
  handlePointerLockChange() {
    const isLocked = document.pointerLockElement === document.body;
    this.isPointerLocked = isLocked;
    
    if (!isLocked && this.isActive) {
      document.body.style.cursor = 'default'; // Ensure cursor is visible
    }
  }

  handlePointerLockError() {
    console.warn("Pointer lock error occurred");
    this.isPointerLocked = false;
    document.body.style.cursor = 'default';
  }

  // Method to lock cursor and hide pointer
  lockCursorAndHide() {
    if (this.isPointerLocked) {
      return;
    }
    
    // Hide cursor and request pointer lock
    document.body.style.cursor = 'none';
    document.body.requestPointerLock();
    // Note: isPointerLocked will be set to true in the change event handler
  }

  // Method to unlock cursor and show pointer
  unlockCursorAndShow() {
    if (!this.isPointerLocked) {
      return;
    }
    
    // Show cursor and exit pointer lock
    document.body.style.cursor = 'default';
    document.exitPointerLock();
    // Note: isPointerLocked will be set to false in the change event handler
  }

  handleMouseClick(event) {
    if (!this.isActive) return;
    
    // On any click while gun camera is active, (re)lock cursor
    if (event.button === 0) { // Left click
      this.lockCursorAndHide();
    }
  }

  handleMouseWheel(event) {
    if (!this.isActive) return;
    
    event.preventDefault();
    
    // Use scroll direction: positive deltaY = scroll down (zoom out), negative deltaY = scroll up (zoom in)
    if (event.deltaY > 0) {
      // Scroll down - zoom out (decrease zoom index)
      this.currentZoomIndex = Math.max(0, this.currentZoomIndex - 1);
    } else {
      // Scroll up - zoom in (increase zoom index)
      this.currentZoomIndex = Math.min(this.zoomLevels.length - 1, this.currentZoomIndex + 1);
    }
    
    const zoomLevel = this.zoomLevels[this.currentZoomIndex];
    const fovDeg = this.baseFOV / zoomLevel;
    
    // Update camera FOV
    this.camera.fov = fovDeg;
    this.camera.updateProjectionMatrix();
    
    // Scale reticle
    this.updateReticleScale(zoomLevel);
    
    console.log(`Gun camera zoom: ${zoomLevel}x (${fovDeg.toFixed(1)}° FOV)`);
  }

  updateReticleScale(zoomLevel) {
    const reticle = document.getElementById('reticle');
    if (reticle) {
      // Scale reticle based on zoom level
      const reticleScale = 3 * zoomLevel;
      reticle.style.transform = `translate(-50%, -50%) scale(${reticleScale})`;
    }
  }

  activate() {
    if (this.isActive || !this.parentNode) return;
    
    this.isActive = true;

    // Reset zoom to first level
    this.currentZoomIndex = 0;
    const zoomLevel = this.zoomLevels[this.currentZoomIndex];
    this.camera.fov = this.baseFOV / zoomLevel;
    this.camera.updateProjectionMatrix();

    // Store original scene camera
    this.originalCamera = this.scene.camera;
    
    // Switch scene to use our gun camera
    this.scene.setActiveCamera(this.camera);

    // Reset turret roll to 0 (level the gun)
    if (this.vehicle.turretTraverseAxis) {
      this.vehicle.turretTraverseAxis.rotation.z = 0;
    }
    if (this.vehicle.turretElevationAxis) {
      this.vehicle.turretElevationAxis.rotation.z = 0;
    }

    // Show reticle
    const reticle = document.getElementById('reticle');
    if (reticle) {
      reticle.style.display = 'block';
    }
    
    // Set initial reticle scale
    this.updateReticleScale(zoomLevel);

    // Add pointer lock event listeners (remove first to prevent duplicates)
    document.removeEventListener('pointerlockchange', this.boundHandlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.boundHandlePointerLockError);
    document.addEventListener('pointerlockchange', this.boundHandlePointerLockChange);
    document.addEventListener('pointerlockerror', this.boundHandlePointerLockError);

    // Lock cursor and hide pointer immediately
    this.lockCursorAndHide();

    // Add event listeners (remove first to prevent duplicates)
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mousedown', this.boundHandleMouseClick);
    document.removeEventListener('wheel', this.boundHandleMouseWheel);
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mousedown', this.boundHandleMouseClick);
    document.addEventListener('wheel', this.boundHandleMouseWheel, { passive: false });
    
    // Initialize mouse position
    this.lastMouseX = 0;
    this.lastMouseY = 0;
  }

  deactivate() {
    if (!this.isActive) return;
    
    this.isActive = false;

    // Restore original scene camera
    if (this.originalCamera) {
      this.scene.setActiveCamera(this.originalCamera);
    }

    // Reset turret rotations to 0 (clean slate for other camera modes)
    if (this.vehicle.turretTraverseAxis) {
      this.vehicle.turretTraverseAxis.rotation.y = 0;
      this.vehicle.turretTraverseAxis.rotation.z = 0;
    }
    if (this.vehicle.turretElevationAxis) {
      this.vehicle.turretElevationAxis.rotation.x = 0;
      this.vehicle.turretElevationAxis.rotation.z = 0;
    }

    // Hide reticle
    const reticle = document.getElementById('reticle');
    if (reticle) {
      reticle.style.display = 'none';
    }

    // Unlock cursor if it was locked
    this.unlockCursorAndShow();
    
    // Force the flag to false immediately (don't wait for the event)
    this.isPointerLocked = false;

    // Remove all event listeners
    document.removeEventListener('pointerlockchange', this.boundHandlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.boundHandlePointerLockError);
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mousedown', this.boundHandleMouseClick);
    document.removeEventListener('wheel', this.boundHandleMouseWheel);
  }

  handleMouseMove(event) {
    if (!this.isActive || !this.vehicle || !this.isPointerLocked) return;

    // Use movementX and movementY from pointer lock API for better control
    const deltaX = event.movementX || 0;
    const deltaY = event.movementY || 0;
    
    // Get mouse sensitivity from GUI
    const mouseSensitivity = guiState.gunMouseSensitivity;
    
    // Update turret rotation based on mouse movement
    // Use the correct nodes for traverse and elevation
    
    // Horizontal movement (deltaX) rotates turret traverse around Y axis
    if (this.vehicle.turretTraverseAxis) {
      this.vehicle.turretTraverseAxis.rotation.y -= deltaX * mouseSensitivity;
    }
    
    // Vertical movement (deltaY) rotates gun elevation around X axis
    if (this.vehicle.turretElevationAxis) {
      this.vehicle.turretElevationAxis.rotation.x += deltaY * mouseSensitivity;
      
      // Clamp elevation rotation to reasonable limits
      this.vehicle.turretElevationAxis.rotation.x = Math.max(-Math.PI/6, Math.min(Math.PI/6, this.vehicle.turretElevationAxis.rotation.x));
    }
  }

  update(deltaTime) {

  }

  // Cleanup when camera is no longer needed
  dispose() {
    this.deactivate();
  }
} 