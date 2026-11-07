// Vertex shader - simple passthrough
const vertexShader = `
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// Fragment shader - converted from the original
const fragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uSmoothness;
    
    varying vec2 vUv;
    
    // Hash functions
    float hash1(float n) { 
        return fract(sin(n) * 43758.5453); 
    }
    
    vec2 hash2(vec2 p) { 
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); 
        return fract(sin(p) * 43758.5453); 
    }
    
    // Voronoi function with smoothness control
    float voronoi(in vec2 x, float w, float offset) {
        vec2 n = floor(x);
        vec2 f = fract(x);
        float m = 8.0;
        
        for(int j = -2; j <= 2; j++) {
            for(int i = -2; i <= 2; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = hash2(n + g);
                
                // Animate
                o = offset + 0.3 * sin(iTime * uSpeed + 6.2831 * o + x);
                
                // Distance to cell
                float d = length(g - f + o);
                
                // Smooth min for colors and distances
                float h = smoothstep(-1.0, 1.0, (m - d) / w);
                m = mix(m, d, h) - h * (1.0 - h) * w / (1.0 + 3.0 * w);
            }
        }
        
        return m;
    }
    
    void main() {
        // Normalize coordinates from -1 to 1 with center at 0,0
        vec2 uv = (vUv * 2.0 - 1.0) * vec2(iResolution.x / iResolution.y, 1.0);
        
        uv = uv * uScale;
        
        // Move canvas diagonally
        uv.x += iTime * uSpeed * 0.5;
        uv.y += iTime * uSpeed * 0.25;
        
        // Color palette
        vec4 a = vec4(0.114, 0.635, 0.847, 1.0);  // Blue
        vec4 b = vec4(0.8, 0.8, 0.9, 1.0);  // Light blue instead of white
        vec4 c = a * 0.8;  // Darkened blue
        
        // First Voronoi layer
        float vNoise = voronoi(uv, 0.001, 0.5);
        float sNoise = voronoi(uv, uSmoothness, 0.5);
        float fVoronoi = smoothstep(0.0, 0.01, vNoise - sNoise);
        
        // Second offset Voronoi layer
        float vNoise2 = voronoi(uv, 0.001, 0.3);
        float sNoise2 = voronoi(uv, uSmoothness, 0.3);
        float offsetVoronoi = smoothstep(0.0, 0.01, vNoise2 - sNoise2);
        
        // Background stripes
        float pi = 3.14159265359;
        float wave = sin(pi * (uv.x + uv.y));
        wave = (wave + 1.0) / 2.0;  // Normalize to 0-1 range
        
        // Mix colors
        vec4 bgColor = mix(a, c, wave);
        vec4 bgColor2 = mix(a, c, offsetVoronoi + wave);
        
        // Final composition
        vec4 finalVoronoi = vec4(mix(bgColor2.rgb, b.rgb, fVoronoi), 1.0);
        
        gl_FragColor = finalVoronoi;
    }
`;

function createWaterMaterial(speed = 1.0, scale = 2.0, smoothness = 0.4) {
    const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uSpeed: { value: speed },
        uScale: { value: scale },
        uSmoothness: { value: smoothness }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });

    return material;
}

export { createWaterMaterial, vertexShader, fragmentShader }; 