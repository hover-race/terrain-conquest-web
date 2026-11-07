export class TopoMaterial {
  static create(minHeight = -10.0, maxHeight = 50.0, flagPositions = []) {
    // Convert flag positions to flat array format that Three.js expects
    const maxFlags = 20;
    const flatPositions = new Float32Array(maxFlags * 3);
    
    for (let i = 0; i < maxFlags; i++) {
      if (i < flagPositions.length) {
        flatPositions[i * 3] = flagPositions[i].x;
        flatPositions[i * 3 + 1] = flagPositions[i].y;
        flatPositions[i * 3 + 2] = flagPositions[i].z;
      } else {
        // Fill unused slots with zeros
        flatPositions[i * 3] = 0;
        flatPositions[i * 3 + 1] = 0;
        flatPositions[i * 3 + 2] = 0;
      }
    }

    return new THREE.ShaderMaterial({
      uniforms: {
        minHeight: { value: minHeight },
        maxHeight: { value: maxHeight },
        flagPositions: { value: flatPositions },
        numFlags: { value: Math.min(flagPositions.length, maxFlags) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying float vElevation;
        
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vElevation = worldPosition.y;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float minHeight;
        uniform float maxHeight;
        uniform float flagPositions[60]; // 20 flags * 3 components each
        uniform int numFlags;
        varying vec3 vWorldPosition;
        varying float vElevation;
        
        vec3 getTopoColor(float elevation) {
          // Normalize elevation to 0-1 range
          float t = clamp((elevation - minHeight) / (maxHeight - minHeight), 0.0, 1.0);
          
          // Topographic color scheme (blue to green to yellow to red)
          vec3 color1 = vec3(0.0, 0.2, 0.8); // Deep blue (water/low)
          vec3 color2 = vec3(0.0, 0.6, 0.3); // Green (low land)
          vec3 color3 = vec3(0.8, 0.8, 0.2); // Yellow (medium elevation)
          vec3 color4 = vec3(0.8, 0.3, 0.1); // Orange-red (high elevation)
          vec3 color5 = vec3(0.9, 0.9, 0.9); // Light gray peaks instead of white
          
          if (t < 0.25) {
            return mix(color1, color2, t * 4.0);
          } else if (t < 0.5) {
            return mix(color2, color3, (t - 0.25) * 4.0);
          } else if (t < 0.75) {
            return mix(color3, color4, (t - 0.5) * 4.0);
          } else {
            return mix(color4, color5, (t - 0.75) * 4.0);
          }
        }
        
        vec3 getVoronoiColor(vec2 pos) {
          if (numFlags == 0) return vec3(0.0);
          
          float minDist = 999999.0;
          int closestFlag = 0;
          
          // Find closest flag
          for (int i = 0; i < 20; i++) {
            if (i >= numFlags) break;
            
            vec2 flagPos = vec2(flagPositions[i * 3], flagPositions[i * 3 + 2]);
            float dist = distance(pos, flagPos);
            
            if (dist < minDist) {
              minDist = dist;
              closestFlag = i;
            }
          }
          
          // Generate colors based on flag index
          float hue = float(closestFlag) * 0.618033988749; // Golden ratio for good color distribution
          hue = fract(hue);
          
          // Convert HSV to RGB (simplified)
          vec3 c = vec3(hue, 0.7, 0.8);
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          vec3 voronoiColor = c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          
          // Add edge detection for Voronoi cells
          float secondMinDist = 999999.0;
          for (int i = 0; i < 20; i++) {
            if (i >= numFlags || i == closestFlag) continue;
            
            vec2 flagPos = vec2(flagPositions[i * 3], flagPositions[i * 3 + 2]);
            float dist = distance(pos, flagPos);
            
            if (dist < secondMinDist) {
              secondMinDist = dist;
            }
          }
          
          // Create edge effect
          float edgeWidth = 5.0;
          float edge = smoothstep(0.0, edgeWidth, secondMinDist - minDist);
          voronoiColor = mix(vec3(0.0), voronoiColor, edge);
          
          return voronoiColor;
        }
        
        void main() {
          vec3 topoColor = getTopoColor(vElevation);
          
          // Add contour lines effect
          float contourInterval = 5.0; // Contour every 5 units
          float contour = mod(vElevation, contourInterval);
          float contourLine = smoothstep(0.0, 0.5, contour) * smoothstep(contourInterval, contourInterval - 0.5, contour);
          
          // Darken at contour lines
          topoColor *= (0.7 + 0.3 * contourLine);
          
          // Get Voronoi overlay
          vec3 voronoiColor = getVoronoiColor(vWorldPosition.xz);
          
          // Blend Voronoi with terrain (additive with transparency)
          float voronoiStrength = 0.99;
          vec3 finalColor = mix(topoColor, topoColor + voronoiColor * voronoiStrength, step(0.01, length(voronoiColor)));
          
          gl_FragColor = vec4(finalColor, 0.9);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });
  }

  static createSimple(minHeight = -10.0, maxHeight = 10.0) {
    return new THREE.ShaderMaterial({
      uniforms: {
        minHeight: { value: minHeight },
        maxHeight: { value: maxHeight },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying float vElevation;
        
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vElevation = worldPosition.y;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float minHeight;
        uniform float maxHeight;
        varying float vElevation;
        
        vec3 getTopoColor(float elevation) {
          float t = clamp((elevation - minHeight) / (maxHeight - minHeight), 0.0, 1.0);
          
          vec3 color1 = vec3(0.0, 0.2, 0.8); // Deep blue
          vec3 color2 = vec3(0.0, 0.6, 0.3); // Green
          vec3 color3 = vec3(0.8, 0.8, 0.2); // Yellow
          vec3 color4 = vec3(0.8, 0.3, 0.1); // Orange-red
          
          if (t < 0.33) {
            return mix(color1, color2, t * 3.0);
          } else if (t < 0.66) {
            return mix(color2, color3, (t - 0.33) * 3.0);
          } else {
            return mix(color3, color4, (t - 0.66) * 3.0);
          }
        }
        
        void main() {
          vec3 topoColor = getTopoColor(vElevation);
          gl_FragColor = vec4(topoColor, 0.8);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });
  }
}

export class VoronoiMaterial {
  static create(flagPositions = [], waterLevel = 0.0, mountainPeak = 50.0) {
    const maxFlags = 20;
    const flatPositions = new Float32Array(maxFlags * 3);
    const flagColors = new Float32Array(maxFlags * 3);

    for (let i = 0; i < maxFlags; i++) {
      if (i < flagPositions.length) {
        flatPositions[i * 3] = flagPositions[i].x;
        flatPositions[i * 3 + 1] = flagPositions[i].y;
        flatPositions[i * 3 + 2] = flagPositions[i].z;

        // Use actual flag color
        const color = new THREE.Color(flagPositions[i].color);
        flagColors[i * 3] = color.r;
        flagColors[i * 3 + 1] = color.g;
        flagColors[i * 3 + 2] = color.b;
      }
    }

    return new THREE.ShaderMaterial({
      uniforms: {
        flagPositions: { value: flatPositions },
        flagColors: { value: flagColors },
        numFlags: { value: Math.min(flagPositions.length, maxFlags) },
        waterLevel: { value: waterLevel },
        mountainPeak: { value: mountainPeak },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying float vElevation;
        
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vElevation = worldPosition.y;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float flagPositions[60]; // 20 flags * 3 components each
        uniform float flagColors[60]; // 20 flags * 3 components each
        uniform int numFlags;
        uniform float waterLevel;
        uniform float mountainPeak;
        varying vec3 vWorldPosition;
        varying float vElevation;

        void main() {
          // Handle underwater areas with dark blue color
          if (vElevation <= waterLevel) {
            gl_FragColor = vec4(0.0, 0.067, 0.133, 1.0); // Dark blue (#001122)
            return;
          }

          // Calculate brightness based on elevation for above-water areas
          float normalizedElevation = clamp((vElevation - waterLevel) / (mountainPeak - waterLevel), 0.0, 1.0);
          float brightness = 0.5 + 0.5 * normalizedElevation;

          float minDistance = 1e10;
          int closestFlagIndex = -1;

          for (int i = 0; i < 20; ++i) {
            if (i >= numFlags) break;
            vec2 flagPos = vec2(flagPositions[i * 3], flagPositions[i * 3 + 2]);
            float dist = distance(vWorldPosition.xz, flagPos);
            if (dist < minDistance) {
              minDistance = dist;
              closestFlagIndex = i;
            }
          }

          vec3 baseColor = vec3(
            flagColors[closestFlagIndex * 3],
            flagColors[closestFlagIndex * 3 + 1], 
            flagColors[closestFlagIndex * 3 + 2]
          );
          gl_FragColor = vec4(baseColor * brightness, 1.0);
        }
      `,
      side: THREE.DoubleSide
    });
  }
}

export class VehicleMaterial {
  static create() {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          vUv = uv;
          vPosition = position;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        float drawArrow(vec2 uv) {
          // Center the UV coordinates
          vec2 p = uv - 0.5;
          
          // Arrow shape using distance fields
          // Arrow head (triangle)
          float arrowHead = max(
            abs(p.x) - (0.3 - p.y * 0.6), // Angled sides
            p.y - 0.2 // Top edge
          );
          
          // Arrow shaft (rectangle)
          float arrowShaft = max(
            abs(p.x) - 0.1, // Width
            abs(p.y + 0.1) - 0.3 // Height and position
          );
          
          // Combine head and shaft
          float arrow = min(arrowHead, arrowShaft);
          
          // Create smooth edges
          return 1.0 - smoothstep(-0.02, 0.02, arrow);
        }
        
        void main() {
          float arrow = drawArrow(vUv);
          
          // Red color with some brightness variation
          vec3 redColor = vec3(1.0, 0.1, 0.1);
          
          // Add a subtle pulse effect
          float pulse = 0.8 + 0.2 * sin(time * 3.0);
          
          // Final color
          vec3 finalColor = redColor * pulse;
          
          gl_FragColor = vec4(finalColor, arrow);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  static createGeometry() {
    // Create arrow-shaped geometry
    const shape = new THREE.Shape();
    
    // Arrow head (triangle)
    shape.moveTo(0, 0.4);      // Top point
    shape.lineTo(-0.2, 0.1);   // Left point
    shape.lineTo(-0.08, 0.1);  // Left inner
    shape.lineTo(-0.08, -0.4); // Left bottom
    shape.lineTo(0.08, -0.4);  // Right bottom
    shape.lineTo(0.08, 0.1);   // Right inner
    shape.lineTo(0.2, 0.1);    // Right point
    shape.lineTo(0, 0.4);      // Back to top
    
    const geometry = new THREE.ShapeGeometry(shape);
    
    // Scale the geometry
    geometry.scale(10, 10, 1);
    
    return geometry;
  }
} 