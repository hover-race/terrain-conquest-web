import { guiState } from './gui.js';
import { isUiEvent } from './gameInput.js'

export class RTSCamera {
  camera; // The main THREE.Camera
  target; // The THREE.Object3D to follow
  vehicle; // Vehicle reference to access turret
  scene; // Scene reference

  // Configuration
  baseDistance = 20;
  minDistance = 5;
  maxDistance = 100;
  initialPitch = Math.PI / 4; // 45 degrees down (like baseAngle)
  minPitch = 0.1;          // Minimum pitch (slightly above horizontal)
  maxPitch = Math.PI / 2 - 0.1; // Maximum pitch (slightly below vertical)

  lerpFactor = 0.05; // Smoothing factor (lower is smoother)
  azimuthSensitivity = 0.01; // Sensitivity for horizontal rotation
  pitchSensitivity = 0.005; // Sensitivity for vertical rotation

  // State
  currentDistance;      // Renamed from currentHeight
  currentPitch;         // Renamed from currentAngle
  currentAzimuth = 0; // Horizontal angle around target (0 = looking along +Z)
  desiredPosition = new THREE.Vector3();
  isDragging = false;
  previousMouseX = 0;
  previousMouseY = 0; // Added for vertical drag tracking
  isActive = false; // Track if this camera is active
  boundHandleScroll; // Store bound functions for removal
  boundHandleMouseDown;
  boundHandleMouseMove;
  boundHandleMouseUp;

  constructor(camera, target, vehicle, scene) {
    this.camera = camera;
    this.target = target;
    this.vehicle = vehicle;
    this.scene = scene;
    this.currentDistance = this.baseDistance;
    this.currentPitch = this.initialPitch;

    // Store bound event handlers
    this.boundHandleScroll = this.handleScroll.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
  }

  activate() {
    if (this.isActive || !this.target) return;
    this.isActive = true;

    // Reset state to defaults when activated, INCLUDING reading from guiState for distance
    this.currentDistance = (typeof guiState !== 'undefined') ? guiState.rtsCameraDistance : this.baseDistance;
    if (typeof guiState !== 'undefined') guiState.rtsCameraDistance = this.currentDistance; // Ensure GUI state matches

    this.currentPitch = this.initialPitch;
    this.currentAzimuth = 0; // Reset azimuth
    this.isDragging = false;

    // Set initial position immediately
    this.updateDesiredPosition();
    this.camera.position.copy(this.desiredPosition);
    this.camera.lookAt(this.target.getWorldPosition(new THREE.Vector3()));

    // Add listeners
    document.addEventListener('wheel', this.boundHandleScroll, { passive: false });
    document.addEventListener('mousedown', this.boundHandleMouseDown);
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
    console.log("RTSCamera Activated");
  }

  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    this.isDragging = false; // Ensure dragging stops

    // Remove listeners
    document.removeEventListener('wheel', this.boundHandleScroll);
    document.removeEventListener('mousedown', this.boundHandleMouseDown);
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    console.log("RTSCamera Deactivated");
  }

  handleScroll(event) {
    if (event.defaultPrevented || isUiEvent(event)) return;
    event.preventDefault(); // Prevent page scrolling

    // Read sensitivity from global state
    const currentZoomSensitivity = guiState.rtsZoomSpeed;

    const zoomDelta = event.deltaY * currentZoomSensitivity; // Use value from guiState

    // Adjust distance (previously height)
    this.currentDistance = THREE.MathUtils.clamp(
      this.currentDistance + zoomDelta,
      this.minDistance, // Use minDistance
      this.maxDistance  // Use maxDistance
    );

    // Update the guiState as well when scroll changes distance
    if (typeof guiState !== 'undefined') {
      guiState.rtsCameraDistance = this.currentDistance;
      if (typeof updateGuiRtsCameraControls === 'function') {
        updateGuiRtsCameraControls(); // Refresh the GUI display
      }
    }

    // // Adjust angle based on height (REMOVED - Pitch is now controlled by dragging)
    // const heightRatio = (this.currentHeight - this.minHeight) / (this.maxHeight - this.minHeight);
    // this.currentAngle = THREE.MathUtils.lerp(this.maxAngle, this.minAngle, heightRatio);
    // // Clamp angle just in case
    // this.currentAngle = THREE.MathUtils.clamp(this.currentAngle, this.minAngle, this.maxAngle);

    // console.log(`[Scroll] New Distance: ${this.currentDistance.toFixed(2)}`); // Updated log
  }

  handleMouseDown(event) {
    if (event.defaultPrevented || isUiEvent(event)) return;
    // Start dragging only on left click (button 0)
    if (event.button === 0) {
        this.isDragging = true;
        this.previousMouseX = event.clientX;
        this.previousMouseY = event.clientY; // Store initial Y position
    }
  }

  handleMouseMove(event) {
    if (!this.isDragging) return;

    const deltaX = event.clientX - this.previousMouseX;
    const deltaY = event.clientY - this.previousMouseY; // Calculate Y delta
    this.previousMouseX = event.clientX;
    this.previousMouseY = event.clientY; // Update Y position

    // Update azimuth angle based on horizontal mouse movement
    this.currentAzimuth -= deltaX * this.azimuthSensitivity;
    this.currentAzimuth = (this.currentAzimuth + Math.PI * 2) % (Math.PI * 2);

    // Update pitch angle based on vertical mouse movement
    this.currentPitch += deltaY * this.pitchSensitivity;
    // Clamp pitch to avoid looking too high or low
    this.currentPitch = THREE.MathUtils.clamp(this.currentPitch, this.minPitch, this.maxPitch);

    // console.log(`[Drag] Azimuth: ${this.currentAzimuth.toFixed(2)}, Pitch: ${this.currentPitch.toFixed(2)}`); // Debug log
  }

  handleMouseUp(event) {
    if (event.button === 0) {
        this.isDragging = false;
    }
  }

  updateDesiredPosition() {
    if (!this.target) return;

    // Read distance from guiState at the start of updating desired position
    // This ensures GUI changes are reflected immediately if not scrolling
    if (typeof guiState !== 'undefined') {
      this.currentDistance = guiState.rtsCameraDistance;
    }

    const targetPosition = this.target.getWorldPosition(new THREE.Vector3());

    // Calculate position using spherical coordinates
    const horizontalDistance = this.currentDistance * Math.cos(this.currentPitch);
    const verticalHeight = this.currentDistance * Math.sin(this.currentPitch);
    const offsetX = horizontalDistance * Math.sin(this.currentAzimuth);
    const offsetZ = horizontalDistance * Math.cos(this.currentAzimuth);

    this.desiredPosition.set(
      targetPosition.x + offsetX,
      targetPosition.y + verticalHeight, // Use calculated vertical height
      targetPosition.z + offsetZ
    );
  }

  update(deltaTime) {
    // Only update if active
    if (!this.isActive || !this.target) return;

    this.updateDesiredPosition();

    // Smoothly interpolate camera position
    this.camera.position.lerp(this.desiredPosition, this.lerpFactor);

    // Always look at the target's current position
    const targetPosition = this.target.getWorldPosition(new THREE.Vector3());
    this.camera.lookAt(targetPosition);

    // Call turret aiming when this camera is active
    if (this.vehicle && this.vehicle.turret && this.scene && this.scene.mouseCoords) {
      this.vehicle.turret.aimTurret(this.scene, this.scene.mouseCoords);
    }
  }

  // Cleanup listener when camera is no longer needed
  dispose() {
    this.deactivate(); // Ensure listeners are removed
    // If the pubsub listener needs removal, handle it here (might need a stored reference)
  }
}
