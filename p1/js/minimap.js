import { VoronoiMaterial } from './shaders.js';

export class Minimap {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = { worldSize: 500, size: 200, ...options };
    this.size = this.options.size;
    this.renderInterval = 1000; // Render every 1 second
    this.voronoiMaterials = []; // Store references to VoronoiMaterials for updating
    
    // Make orthographic camera bounds larger to capture more terrain
    const cameraSize = this.options.worldSize / 2;
    this.camera = new THREE.OrthographicCamera(-cameraSize, cameraSize, cameraSize, -cameraSize, 1, 1000);
    this.camera.position.set(0, 300, 0); // Higher up to see more
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 0, -1);
    
    // Set camera to render specific layers
    this.camera.layers.set(1); // Only render layer 1 (minimap layer)

    // Create a purple test cube on minimap layer
    // const cubeGeometry = new THREE.BoxGeometry(20, 20, 20);
    // const cubeMaterial = new THREE.MeshBasicMaterial({ color: 0x800080 }); // Purple
    // this.testCube = new THREE.Mesh(cubeGeometry, cubeMaterial);
    // this.testCube.position.set(0, 10, 0); // Place it at origin, above ground
    // this.testCube.layers.set(1); // Put on minimap layer
    // this.scene.scene.add(this.testCube);

    // Create minimap-specific terrain representation
    this.createMinimapTerrain();

    // Use existing minimap container from HTML
    this.container = document.getElementById('minimap-container');
    if (!this.container) {
      throw new Error('Minimap container #minimap-container not found in HTML. Please add <div id="minimap-container"></div> to your HTML.');
    }
    
    // Create separate canvas and renderer for minimap
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'minimap'
    this.canvas.width = this.size
    this.canvas.height = this.size
    
    // Most styling is now handled by style.css for the #minimap ID
    
    this.container.appendChild(this.canvas)
    
    // Create separate WebGL renderer for minimap
    this.minimapRenderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: false,
      alpha: true 
    });
    this.minimapRenderer.setSize(this.size, this.size);
    this.minimapRenderer.setClearColor(0x001122, 1.0); // Dark blue background
    
    // Get 2D context for overlay drawing
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = this.size;
    this.overlayCanvas.height = this.size;
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '10000'; // Keep overlay on top
    this.container.appendChild(this.overlayCanvas);
    this.ctx = this.overlayCanvas.getContext('2d');

    // Add ResizeObserver to handle container resizing
    this.resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        this.resize(width, height);
      }
    });
    this.resizeObserver.observe(this.container);

    // Start the interval-based rendering
    this.startRendering();
  }

  resize(width, height) {
    this.size = Math.min(width, height); // Maintain aspect ratio for simplicity
    
    // Update renderer
    this.minimapRenderer.setSize(width, height);
    
    // Update main canvas attributes
    this.canvas.width = width;
    this.canvas.height = height;

    // Update overlay canvas attributes
    this.overlayCanvas.width = width;
    this.overlayCanvas.height = height;

    // The CSS handles the visual size, so we just need to update render resolution
    // and redraw.

    // Force a re-render
    this.render();
  }

  startRendering() {
    this.render();
    this.intervalId = setInterval(() => {
      this.render();
    }, this.renderInterval);
  }

  stopRendering() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  render() {
    // Robustly get player position (supports car or car.chassis)
    let playerPos = null;
    if (this.scene.car) {
      if (this.scene.car.position) {
        playerPos = this.scene.car.position;
      } else if (this.scene.car.chassis && this.scene.car.chassis.position) {
        playerPos = this.scene.car.chassis.position;
      }
    }
    if (!playerPos) return;

    // Follow player - keep camera high above
    this.camera.position.x = playerPos.x;
    this.camera.position.y = 300; // Keep high
    this.camera.position.z = playerPos.z;
    this.camera.lookAt(playerPos.x, 0, playerPos.z);

    // Render 3D scene with separate renderer
    this.minimapRenderer.render(this.scene.scene, this.camera);

    // Clear overlay canvas and draw 2D overlay elements
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.drawDelivery(playerPos);
    
    // Draw player
    // this.drawPlayer(playerPos);
    
    // Draw flags
    // this.drawFlags();
    
  }

  update() {
    // This method is now empty since we use interval-based rendering
    // Keep it for compatibility with existing code that calls it
  }

  drawDelivery(playerPos) {
    const network = this.scene.freight;
    if (!network) return;
    const center = this.size / 2;
    const scale = this.size / this.options.worldSize;
    const project = position => ({
      x: Math.max(10, Math.min(this.size - 10, center + (position.x - playerPos.x) * scale)),
      y: Math.max(10, Math.min(this.size - 10, center + (position.z - playerPos.z) * scale)),
    });
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    for (const stop of network.stops) {
      const p = project(stop);
      ctx.fillStyle = '#6cbfc3';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(stop.id.replace('stop-', ''), p.x, Math.max(10, p.y - 7));
    }
    for (const job of network.jobs) {
      const p = project(job.trailer.chassis.position);
      ctx.fillStyle = job.type === 'small' ? '#c3e4ff' : '#e5c9ff';
      ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
    }
    if (network.navigationTarget) {
      const target = project(network.navigationTarget);
      ctx.strokeStyle = '#ffc65c'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(target.x, target.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = network.mission?.status === 'complete' ? '#85e8a5' : '#ffc65c';
      ctx.fillRect(target.x - 5, target.y - 5, 10, 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(network.navigationLabel.toUpperCase(), target.x, Math.max(12, target.y - 10));
    }
    ctx.fillStyle = '#6cbfff';
    ctx.beginPath(); ctx.arc(center, center, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  createMinimapTerrain() {
    const flagPositions = this.scene.terrain2.freightStops;

    // Create a simplified terrain representation for the minimap
    this.scene.terrain2.mauiModel.traverse((child) => {
      if (child.isMesh) {
        // Create a clone with minimap-specific material
        const minimapMesh = child.clone();
        
        // Use VoronoiMaterial from shaders.js with flag positions
        const voronoiMaterial = VoronoiMaterial.create(flagPositions, this.scene.terrain2.config.waterLevel, this.scene.terrain2.mountainPeak);
        
        // Store reference to material for updates
        this.voronoiMaterials.push(voronoiMaterial);
        
        minimapMesh.material = voronoiMaterial;
        minimapMesh.layers.set(1); // Put on minimap layer
        this.scene.scene.add(minimapMesh);
      }
    });
  }

  drawPlayer(playerPos) {
    const mapPos = this.worldToMinimap(playerPos);

    // Draw player as yellow circle
    this.ctx.fillStyle = 'yellow';
    this.ctx.strokeStyle = 'black';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(mapPos.x, mapPos.y, 6, 0, 2 * Math.PI);
    this.ctx.fill();
    this.ctx.stroke();
  }

  drawFlags() {
    if (!this.scene.terrain2 || !this.scene.terrain2.flags) return;

    this.scene.terrain2.flags.forEach(flag => {
        const flagPos = flag.config.position;
        const mapPos = this.worldToMinimap(flagPos);

        // Draw flag as square
        this.ctx.fillStyle = flag.captured ? 'lightgreen' : 'red';
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 1;
        this.ctx.fillRect(mapPos.x - 4, mapPos.y - 4, 8, 8);
        this.ctx.strokeRect(mapPos.x - 4, mapPos.y - 4, 8, 8);
    });
  }

  worldToMinimap(worldPos) {
    // Map world coordinates to minimap canvas coordinates
    // Use the overlayCanvas dimensions as the source of truth for size,
    // as it's what the ResizeObserver updates.
    const mapSize = this.overlayCanvas.width;
    const worldSize = this.options.worldSize;
    
    const x = (worldPos.x / worldSize) * mapSize + mapSize / 2;
    const y = (worldPos.z / worldSize) * mapSize + mapSize / 2;

    return { x, y };
  }

  updateFlagColors() {
    console.log('updateFlagColors')
    // Get current flag positions and colors
    const flagPositions = [];
    const flagColors = [];
    
    this.scene.terrain2.flags.forEach((flag, index) => {
      if (flag.config && flag.config.position) {
        flagPositions.push(new THREE.Vector3(
          flag.config.position.x,
          flag.config.position.y,
          flag.config.position.z
        ));
        
        // Get the current color from the flag
        const color = new THREE.Color(flag.config.color);
        console.log('color', color)
        flagColors.push(color.r, color.g, color.b);
      }
    });

    // Update all VoronoiMaterial uniforms
    this.voronoiMaterials.forEach(material => {
      // Update the flag colors array
      const maxFlags = 20;
      const flatColors = new Float32Array(maxFlags * 3);
      
      for (let i = 0; i < maxFlags; i++) {
        if (i < flagColors.length / 3) {
          flatColors[i * 3] = flagColors[i * 3];
          flatColors[i * 3 + 1] = flagColors[i * 3 + 1];
          flatColors[i * 3 + 2] = flagColors[i * 3 + 2];
        }
      }
      
      material.uniforms.flagColors.value = flatColors;
      console.log('flatColors', flatColors)
      material.uniforms.flagColors.needsUpdate = true;
    });
  }
}
