import * as THREE from 'three'
import { createWaterMaterial } from './water4.js'
import { findNodesByPrefix } from './util.js'

class Terrain2 {
  constructor(scene, options = {}) {
    this.scene = scene
    this.physics = scene.physics
    this.mauiGltf = options.mauiGltf
    
    // Default configuration
    this.config = {
      waterLevel: options.waterLevel || -4,
      waterColor: options.waterColor || 0x4DD0E1,
      // Water shader options - tuned for cartoon style
      waterDeepColor: options.waterDeepColor || 0x1565C0,  // Deeper blue
      waterFoamColor: options.waterFoamColor || 0xF0F8FF,  // Alice blue for softer foam
      waveHeight: options.waveHeight || 0.4,               // Slightly bigger waves
      waveFrequency: options.waveFrequency || 1.8,         // More organic frequency
      waveSpeed: options.waveSpeed || 0.8,                 // Calmer wave speed
      modelPosition: options.modelPosition || { x: 0, y: 0, z: 0 }, // Position for the GLB model
      // Color palette for height-based coloring (same as terrain.js)
      colorPalette: options.colorPalette || [
        new THREE.Color('wheat'),
        new THREE.Color('greenyellow'),
        new THREE.Color('green'),
        new THREE.Color('gray'),
        new THREE.Color('lightgray')  // Changed from 'white' to prevent bloom
      ],
      terrainMaxHeight: options.terrainMaxHeight || 20,
      terrainMinHeight: options.terrainMinHeight || -4
    }
    
    this.terrainMesh = null
    this.waterMesh = null
    this.wireframeMesh = null
    this.physicsBody = null
    this.mauiModel = null

    this.spawnPos = new THREE.Vector3(0, 0, 0)
    
    this.loadAndGenerate()
  }
  
  // Helper function to interpolate between colors in the palette using THREE.js Color (same as terrain.js)
  getColorForHeight(normalizedHeight) {
    const palette = this.config.colorPalette
    const paletteLength = palette.length
    
    // Clamp height to 0-1 range
    const t = Math.max(0, Math.min(1, normalizedHeight))
    
    // Calculate which segment of the palette we're in
    const segmentFloat = t * (paletteLength - 1)
    const segmentIndex = Math.floor(segmentFloat)
    const segmentT = segmentFloat - segmentIndex
    
    // Handle edge case - if at the very end
    if (segmentIndex >= paletteLength - 1) {
      return palette[paletteLength - 1].clone()
    }
    
    // Get the two colors to interpolate between
    const color1 = palette[segmentIndex]
    const color2 = palette[segmentIndex + 1]
    
    // Use THREE.js color interpolation
    const result = new THREE.Color()
    result.lerpColors(color1, color2, segmentT)
    return result
  }
  
  loadAndGenerate() {
    if (!this.mauiGltf) {
      console.error('Maui GLTF not provided to Terrain2 constructor')
      return
    }
    // Use the provided Maui.glb model
    this.mauiModel = this.mauiGltf.scene
    
    // Scale and position the model
    this.mauiModel.position.set(
      this.config.modelPosition.x,
      this.config.modelPosition.y,
      this.config.modelPosition.z
    )
    
    // Apply height-based coloring to the model
    this.applyHeightBasedColoring()
    
    // Add model to scene
    this.scene.scene.add(this.mauiModel)
    this.mesh = this.mauiModel

    const spawnPosNodes = findNodesByPrefix(this.mauiModel, 'SpawnPos')
    if (spawnPosNodes.length > 0) {
      spawnPosNodes[0].getWorldPosition(this.spawnPos)
    }

    this.flags = []
    this.freightStops = findNodesByPrefix(this.mauiModel, 'Flag').map((marker, index) => {
      const position = marker.getWorldPosition(new THREE.Vector3())
      return {
        id: `stop-${index + 1}`, name: `Freight stop ${index + 1}`,
        x: position.x, y: this.getHeightAtPosition(position.x, position.z), z: position.z,
        color: 0x649c95,
      }
    })
    
    // Compute bounding box for water sizing
    this.waterDimensions = this.computeBoundingBox()
    
    // Create physics for the model
    this.createPhysicsFromModel()
    
    // Create water layer
    this.createWater()
    
  }
  
  computeBoundingBox() {
    if (!this.mauiModel) {
      // Return a default Box3 if no model
      const defaultBox = new THREE.Box3()
      defaultBox.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 100, 500))
      return defaultBox
    }
    
    // Compute bounding box of the scaled and positioned model
    const box = new THREE.Box3().setFromObject(this.mauiModel)
    
    // Calculate dimensions for logging
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    
    console.log(`Model bounding box: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`)
    console.log(`Model center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`)
    
    return box
  }
  
  applyHeightBasedColoring() {
    if (!this.mauiModel) return
    
    const { terrainMaxHeight, terrainMinHeight } = this.config
    const heightRange = terrainMaxHeight - terrainMinHeight
    
    // Traverse through all meshes in the model
    this.mauiModel.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const geometry = child.geometry
        
        // Ensure we have position attribute
        if (!geometry.attributes.position) return
        
        const positions = geometry.attributes.position.array
        const vertexCount = positions.length / 3
        
        // Create colors array for vertex colors
        const colors = new Float32Array(vertexCount * 3)
        
        // Color each vertex based on its Y position (height)
        for (let i = 0; i < vertexCount; i++) {
          const vertexIndex = i * 3
          const worldY = positions[vertexIndex + 1] // Y coordinate
          
          // Calculate normalized height (0 to 1)
          const normalizedHeight = (worldY - terrainMinHeight) / heightRange
          
          // Get color for this height
          const color = this.getColorForHeight(normalizedHeight)
          
          // Set RGB values for this vertex
          colors[vertexIndex] = color.r
          colors[vertexIndex + 1] = color.g
          colors[vertexIndex + 2] = color.b
        }
        
        // Add color attribute to geometry
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        
        // Update the material to use vertex colors
        const material = new THREE.MeshLambertMaterial({
          vertexColors: true,  // Enable vertex coloring
          flatShading: true,   // Prevent color interpolation between faces for more distinct colors
        })
        
        child.material = material
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    
    // Create wireframe after applying materials
    this.createWireframe()
  }
  
  createWireframe() {
    if (!this.mauiModel) return
    
    // Create a group to hold all wireframe segments
    const wireframeGroup = new THREE.Group()
    
    // Create wireframe for each mesh in the model
    this.mauiModel.traverse((child) => {
      if (child.isMesh && child.geometry) {
        // Create edges geometry for wireframe
        const edges = new THREE.EdgesGeometry(child.geometry)
        const edgeMaterial = new THREE.LineBasicMaterial({ 
          color: 'black',
          transparent: true,
          opacity: 0.4,
          linewidth: 5
        })
        const wireframe = new THREE.LineSegments(edges, edgeMaterial)
        
        // Copy the mesh's transform to the wireframe
        wireframe.position.copy(child.position)
        wireframe.rotation.copy(child.rotation)
        wireframe.scale.copy(child.scale)
        
        wireframe.renderOrder = 1  // Render on top of terrain
        wireframeGroup.add(wireframe)
      }
    })
    
    // Add wireframe group to scene
    this.scene.scene.add(wireframeGroup)
    
    // Store reference to wireframe for cleanup
    this.wireframeMesh = wireframeGroup
  }
  
  createPhysicsFromModel() {
    if (!this.mauiModel) return
    
    // Create Ammo.js triangle mesh from the GLB model geometry
    const mesh = new Ammo.btTriangleMesh(true, true)
    
    const vec1 = new Ammo.btVector3(0, 0, 0)
    const vec2 = new Ammo.btVector3(0, 0, 0)
    const vec3 = new Ammo.btVector3(0, 0, 0)
    
    // Process all meshes in the GLB model
    this.mauiModel.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const geometry = child.geometry
        
        // Ensure we have indices and positions
        if (!geometry.index || !geometry.attributes.position) return
        
        const indices = geometry.index.array
        const positions = geometry.attributes.position.array
        
        // Get world matrix for this mesh to transform vertices
        child.updateMatrixWorld(true)
        const worldMatrix = child.matrixWorld
        
        // Convert THREE.js triangles to Ammo.js triangles
        for (let i = 0; i < indices.length; i += 3) {
          const idx1 = indices[i] * 3      // First vertex index * 3 (x,y,z)
          const idx2 = indices[i + 1] * 3  // Second vertex index * 3
          const idx3 = indices[i + 2] * 3  // Third vertex index * 3
          
          // Get vertex positions in local coordinates
          const v1 = new THREE.Vector3(positions[idx1], positions[idx1 + 1], positions[idx1 + 2])
          const v2 = new THREE.Vector3(positions[idx2], positions[idx2 + 1], positions[idx2 + 2])
          const v3 = new THREE.Vector3(positions[idx3], positions[idx3 + 1], positions[idx3 + 2])
          
          // Transform to world coordinates
          v1.applyMatrix4(worldMatrix)
          v2.applyMatrix4(worldMatrix)
          v3.applyMatrix4(worldMatrix)
          
          // Set Ammo vectors
          vec1.setValue(v1.x, v1.y, v1.z)
          vec2.setValue(v2.x, v2.y, v2.z)
          vec3.setValue(v3.x, v3.y, v3.z)
          
          mesh.addTriangle(vec1, vec2, vec3, false)
        }
      }
    })
    
    // Clean up temporary vectors
    Ammo.destroy(vec1)
    Ammo.destroy(vec2)
    Ammo.destroy(vec3)
    
    // Create optimized physics shape from triangle mesh
    const useQuantizedAabbCompression = true
    const triMeshShape = new Ammo.btBvhTriangleMeshShape(mesh, useQuantizedAabbCompression)
    
    // Create static rigid body (mass = 0)
    const mass = 0
    const localInertia = new Ammo.btVector3(0, 0, 0)
    const transform = new Ammo.btTransform()
    transform.setIdentity()
    transform.setOrigin(new Ammo.btVector3(
      this.config.modelPosition.x,
      this.config.modelPosition.y,
      this.config.modelPosition.z
    ))
    
    const motionState = new Ammo.btDefaultMotionState(transform)
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, triMeshShape, localInertia)
    this.physicsBody = new Ammo.btRigidBody(rbInfo)
    
    // Add to physics world for collision detection
    this.physics.physicsWorld.addRigidBody(this.physicsBody)
    
    // Store references for cleanup
    if (this.mauiModel.userData) {
      this.mauiModel.userData.physicsBody = this.physicsBody
      this.mauiModel.userData.ammoMesh = mesh
    }
  }
  
  createWater() {
    // Use the Box3 for water dimensions and positioning
    const box = this.waterDimensions || new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 100, 500))
    
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    
    // Make water 2x the terrain size
    const waterWidth = size.x * 2
    const waterDepth = size.z * 2
    
    console.log(`Creating water plane with size: ${waterWidth.toFixed(2)} x ${waterDepth.toFixed(2)}`)
    console.log(`Centering water at: (${center.x.toFixed(2)}, ${center.z.toFixed(2)})`)
    
    // Create water plane with higher resolution for wave deformation
    const waterGeometry = new THREE.PlaneGeometry(waterWidth, waterDepth, 64, 64)
    waterGeometry.rotateX(-Math.PI / 2)  // Flat on XZ plane
    
    // Create water material using water4 Voronoi-based shader
    const waterMaterial = createWaterMaterial(0.1, 10.0, 0.4)
    
    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial)
    this.waterMesh.position.set(center.x, this.config.waterLevel - 0.1, center.z) // Center around terrain
    this.waterMesh.receiveShadow = true
    this.scene.scene.add(this.waterMesh)
  }
  
  // Update method for water4 animation
  updateWater(camera, time) {
    if (this.waterMesh && this.waterMesh.material) {
      // Update shader uniforms for animation
      this.waterMesh.material.uniforms.iTime.value = time
      
      // Update resolution for better quality
      if (this.scene && this.scene.renderer) {
        const size = this.scene.renderer.getSize(new THREE.Vector2())
        this.waterMesh.material.uniforms.iResolution.value.set(size.x, size.y)
      }
    }
  }
  
  // Utility method to get height at world position (simplified for GLB model)
  getHeightAtPosition(worldX, worldZ) {
    if (!this.mauiModel) {
      return this.config.waterLevel
    }

    // Create raycaster from above the terrain
    const raycaster = new THREE.Raycaster()
    const rayOrigin = new THREE.Vector3(worldX, 100, worldZ) // Start from high above
    const rayDirection = new THREE.Vector3(0, -1, 0) // Ray pointing down
    
    raycaster.set(rayOrigin, rayDirection)
    
    // Get all meshes in the terrain model for intersection testing
    const meshes = []
    this.mauiModel.traverse((child) => {
      if (child.isMesh) {
        meshes.push(child)
      }
    })
    
    // Check for intersections with terrain meshes
    const intersects = raycaster.intersectObjects(meshes, false)
    
    if (intersects.length > 0) {
      return intersects[0].point.y
    }
    
    console.warn('Fallback to water level if no intersection found')
    return this.config.waterLevel
  }
  
  // Clean up resources
  dispose() {
    if (this.mauiModel) {
      this.scene.scene.remove(this.mauiModel)
      this.mauiModel.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose()
          if (child.material.dispose) {
            child.material.dispose()
          }
        }
      })
    }
    
    if (this.wireframeMesh) {
      this.scene.scene.remove(this.wireframeMesh)
      this.wireframeMesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
    }
    
    if (this.waterMesh) {
      this.scene.scene.remove(this.waterMesh)
      this.waterMesh.geometry.dispose()
      this.waterMesh.material.dispose()
    }
    
    if (this.physicsBody) {
      this.physics.physicsWorld.removeRigidBody(this.physicsBody)
    }
  }

  updateFlagCounterUI() {
    if (this.flags) {
      const totalFlags = this.flags.length;
      const capturedFlags = this.flags.filter(flag => flag.captured).length;
      
      const flagCounter = document.getElementById('flag-counter');
      if (flagCounter) {
        flagCounter.textContent = `🏁 ${capturedFlags}/${totalFlags} Flags captured`;
      }
    }
  }
}

export { Terrain2 }
