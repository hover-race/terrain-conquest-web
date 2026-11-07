import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import * as THREE from 'three'
import { muzzleFlashMaterial } from './materials.js'

// Helper function to billboard a particle towards the camera with optional random roll
function billboard(particle, camera, randomRoll = true) {
    if (!camera) return;
    
    particle.lookAt(camera.getWorldPosition(new THREE.Vector3()));
    
    if (randomRoll) {
        const randomRollAngle = Math.random() * Math.PI * 2;
        const rollAxis = new THREE.Vector3(0, 0, 1);
        const rollQuaternion = new THREE.Quaternion().setFromAxisAngle(rollAxis, randomRollAngle);
        particle.quaternion.multiply(rollQuaternion);
    }
}

// Test function to verify Line2 works
function createTestLine(mainScene) {
    console.log('Creating test line...');
    
    // Test with real Three.js Line2
    const geometry = new THREE.LineGeometry();
    const positions = [
        0, 0, 0,      // start point
        50, 50, 50    // end point
    ];
    geometry.setPositions(positions);
    
    const material = new THREE.LineMaterial({
        color: 0x00ff00,  // bright green
        linewidth: 20,    // very thick line
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    });
    
    const line = new THREE.Line2(geometry, material);
    mainScene.scene.add(line);
    console.log('Real Line2 test line created and added to scene');
    return line;
}



class TestCube {
    mainScene;
    cube;
    trailLine;
    trailPoints = [];
    moveInterval;

    constructor(mainScene, position = new THREE.Vector3(20, 20, 20)) {
        this.mainScene = mainScene;
        
        console.log('Creating TestCube at position:', position);
        
        // Create red cube
        const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
        const cubeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        this.cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
        this.cube.position.copy(position);
        this.mainScene.scene.add(this.cube);
        
        // Create Line2 for trail
        const geometry = new THREE.LineGeometry();
        const material = new THREE.LineMaterial({
            color: 0xff0000,  // red trail
            linewidth: 5,
            transparent: true,
            opacity: 0.8,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            worldUnits: false,
            vertexColors: false
        });
        
        this.trailLine = new THREE.Line2(geometry, material);
        this.mainScene.scene.add(this.trailLine);
        
        // Set up interval to move cube every second
        this.moveInterval = setInterval(() => {
            this.cube.position.x -= 1;
            console.log('TestCube moved to:', this.cube.position);
            
            // Add current position to trail points
            const position = this.cube.position.clone();
            this.trailPoints.push(position);
            
            // Update Line2 geometry if we have at least 2 points
            if (this.trailPoints.length >= 2) {
                const positions = [];
                for (const point of this.trailPoints) {
                    positions.push(point.x, point.y, point.z);
                }
                this.trailLine.geometry.setPositions(positions);
            }
        }, 1000);
        
        console.log('TestCube created with Line2 trail');
    }

    update() {
        // Update method now empty since trail updates happen in setInterval
    }

    destroy() {
        // Clear the movement interval
        if (this.moveInterval) {
            clearInterval(this.moveInterval);
            this.moveInterval = null;
        }
        
        if (this.cube) {
            this.mainScene.scene.remove(this.cube);
            this.cube.geometry.dispose();
            this.cube.material.dispose();
            this.cube = null;
        }
        
        if (this.trailLine) {
            this.mainScene.scene.remove(this.trailLine);
            this.trailLine.geometry.dispose();
            this.trailLine.material.dispose();
            this.trailLine = null;
        }
        
        console.log('TestCube destroyed');
    }
}

export function createExplosion(mainScene, position, normal) {
    if (!mainScene) return;
    const { scene, camera } = mainScene; // Destructure camera as well if needed directly
    const particleCount = 50;
    const baseParticleSize = 0.6;
    const particleSpeed = 20;
    const particleLifetimeMs = 300;

    const colorBlack = new THREE.Color(0x000000);
    const colorOrange = new THREE.Color(0xffa500);

    for (let i = 0; i < particleCount; i++) {
        const randomSizeFactor = 0.5 + Math.random();
        const currentParticleSize = baseParticleSize * randomSizeFactor;
        const particleGeometry = new THREE.PlaneGeometry(currentParticleSize, currentParticleSize);

        const randomColor = new THREE.Color().lerpColors(colorBlack, colorOrange, Math.random());
        const particleMaterialInstance = new THREE.MeshStandardMaterial({
            color: randomColor,
            emissive: randomColor,
            emissiveIntensity: 0.6,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });

        const particle = new THREE.Mesh(particleGeometry, particleMaterialInstance);
        particle.position.copy(position);

        billboard(particle, camera);

        const randomDirection = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ).normalize();
        const velocityDirection = randomDirection.lerp(normal, 0.3).normalize();
        const initialParticleVelocity = velocityDirection.multiplyScalar(particleSpeed * (0.5 + Math.random() * 0.5));
        
        scene.add(particle);

        const startTime = Date.now();
        const animateParticle = () => {
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime > particleLifetimeMs) {
                if (particle.parent) scene.remove(particle);
                particleGeometry.dispose();
                if (particle.material) particle.material.dispose();
                return;
            }
            particle.position.addScaledVector(initialParticleVelocity, 0.016);
            particle.material.opacity = 1.0 - (elapsedTime / particleLifetimeMs);
            requestAnimationFrame(animateParticle);
        };
        requestAnimationFrame(animateParticle);
    }
}

export function createDustyExplosion(mainScene, position, normal) {
    if (!mainScene) return;
    const { scene, camera } = mainScene;
    const particleCount = 10;
    const baseParticleSize = 1.2;
    const particleSpeed = 2;
    const particleLifetimeMs = 1000;

    const colorBrown = new THREE.Color(0x8B4513);
    const colorTan = new THREE.Color(0xD2B48C);
    const colorGray = new THREE.Color(0x696969);

    for (let i = 0; i < particleCount; i++) {
        const randomSizeFactor = 0.5 + Math.random() * 1.5;
        const currentParticleSize = baseParticleSize * randomSizeFactor;
        const particleGeometry = new THREE.PlaneGeometry(currentParticleSize, currentParticleSize);

        const randomColor = new THREE.Color().lerpColors(
            colorBrown, 
            Math.random() > 0.5 ? colorTan : colorGray, 
            Math.random()
        );
        
        const particleMaterialInstance = new THREE.MeshStandardMaterial({
            color: randomColor,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });

        const particle = new THREE.Mesh(particleGeometry, particleMaterialInstance);
        particle.position.copy(position);

        billboard(particle, camera);

        const randomDirection = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            Math.random() * 0.8 + 0.2,
            (Math.random() - 0.5) * 2
        ).normalize();
        const velocityDirection = randomDirection.lerp(normal, 0.5).normalize();
        const initialParticleVelocity = velocityDirection.multiplyScalar(particleSpeed * (0.3 + Math.random() * 0.7));
        
        scene.add(particle);

        const startTime = Date.now();
        const animateParticle = () => {
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime > particleLifetimeMs) {
                if (particle.parent) scene.remove(particle);
                particleGeometry.dispose();
                if (particle.material) particle.material.dispose();
                return;
            }
            
            particle.position.addScaledVector(initialParticleVelocity, 0.016);
            initialParticleVelocity.y -= 0.1;
            
            const fadeProgress = elapsedTime / particleLifetimeMs;
            particle.material.opacity = 0.7 * (1.0 - fadeProgress);
            particle.scale.setScalar(1 + fadeProgress * 0.5);
            
            requestAnimationFrame(animateParticle);
        };
        requestAnimationFrame(animateParticle);
    }
}

export function createMuzzleFlash(mainScene, originObject, turretPosition) {
    if (!mainScene || !originObject || !turretPosition) return;
    const { scene, camera } = mainScene;
    if (!camera) return; // Need camera for billboarding

    const flashParticleCount = 4; // Number of planes for the flash
    const baseFlashSize = 0.8;
    const flashLifetimeMs = 200; // Increased from 75ms to make it longer
    const particleMoveSpeed = 2; // Reduced from 5 to make it slower

    const originPosition = new THREE.Vector3();
    originObject.getWorldPosition(originPosition);

    // Optional: Get origin direction to slightly offset flash forward if needed
    // const originDirection = new THREE.Vector3();
    // originObject.getWorldDirection(originDirection);
    // const flashOffset = originDirection.multiplyScalar(0.1); // Small offset

    for (let i = 0; i < flashParticleCount; i++) {
        const randomSizeFactor = 0.7 + Math.random() * 0.6; // Random factor from 0.7 to 1.3
        const currentFlashSize = baseFlashSize * randomSizeFactor;
        const flashGeometry = new THREE.PlaneGeometry(currentFlashSize, currentFlashSize);
        const flashParticle = new THREE.Mesh(flashGeometry, muzzleFlashMaterial); // Share material for efficiency

        // Calculate initial particle position with a slight random offset from originObject
        const randomOffset = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3, // Small random offset
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3
        );
        flashParticle.position.copy(originPosition).add(randomOffset);

        // Calculate direction away from turret center towards the particle's initial (offset) position
        const moveDirection = new THREE.Vector3().subVectors(flashParticle.position, turretPosition).normalize();

        // Billboard + Random Roll
        flashParticle.lookAt(camera.getWorldPosition(new THREE.Vector3()));
        const randomRollAngle = Math.random() * Math.PI * 2; // Full 360-degree random roll
        const rollAxis = new THREE.Vector3(0, 0, 1); // Particle's local Z (direction to camera)
        const rollQuaternion = new THREE.Quaternion().setFromAxisAngle(rollAxis, randomRollAngle);
        flashParticle.quaternion.multiply(rollQuaternion);

        scene.add(flashParticle);

        const particleStartTime = Date.now();
        const animateFlashParticle = () => {
            const elapsedTime = Date.now() - particleStartTime;
            if (elapsedTime >= flashLifetimeMs) {
                if (flashParticle.parent) scene.remove(flashParticle);
                flashGeometry.dispose(); // Dispose geometry per particle
                return; // Stop animation
            }
            // Move particle
            flashParticle.position.addScaledVector(moveDirection, particleMoveSpeed * (16 / 1000)); // (16/1000) approximates deltaTime for 60fps

            // Fade out effect with darkening
            const fadeProgress = elapsedTime / (flashLifetimeMs * 1.8);
            flashParticle.material.opacity = Math.max(0, 0.9 * (1 - fadeProgress));
            
            // Make particles darker over time by reducing emissive intensity
            flashParticle.material.emissiveIntensity = Math.max(0, 1 * (1 - fadeProgress));
            
            // Change color from orange to dark gray over lifetime
            const startColor = new THREE.Color(0xffaa00); // Orange
            const endColor = new THREE.Color(0xff3300);   // Dark gray
            const currentColor = startColor.clone().lerp(endColor, fadeProgress);
            flashParticle.material.color.copy(currentColor);
            // flashParticle.material.emissive.copy(currentColor);
            
            requestAnimationFrame(animateFlashParticle);
        };
        requestAnimationFrame(animateFlashParticle);
    }
    // Material is shared, dispose it only once if no longer needed by any flash, 
    // or manage its lifecycle if these flashes are created frequently.
    // For simplicity here, we might leak it if flashes are continuous.
    // A better approach for frequent effects would be pooling or instancing.
}

class ParticleEmitter {
    mainScene;
    parentObject; // The object to which the emitter is attached (e.g., bullet.mesh)
    particles = [];
    particleSettings = {
        count: 50, // Max particles
        size: 0.1,
        color: new THREE.Color(0x808080), // Gray
        lifetimeMs: 700,
        emissionRate: 25, // Particles per second
        speed: 1,
    };
    lastEmitTime = 0;
    camera;

    constructor(mainScene, parentObject, options = {}) {
        this.mainScene = mainScene;
        this.parentObject = parentObject;
        this.camera = mainScene.camera;
        this.particleSettings = { ...this.particleSettings, ...options };
    }

    emitParticle() {
        const scene = this.mainScene.scene;

        const particleGeometry = new THREE.PlaneGeometry(this.particleSettings.size, this.particleSettings.size);
        const particleMaterial = new THREE.MeshBasicMaterial({
            color: this.particleSettings.color,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });

        const particle = new THREE.Mesh(particleGeometry, particleMaterial);

        // Get current position of the parentObject
        const parentPosition = new THREE.Vector3();
        this.parentObject.getWorldPosition(parentPosition);
        particle.position.copy(parentPosition);

        // Billboard
        billboard(particle, this.camera);

        // Give particle a slight initial velocity, perhaps opposite to parent's movement or just random
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * this.particleSettings.speed,
            (Math.random() - 0.5) * this.particleSettings.speed,
            (Math.random() - 0.5) * this.particleSettings.speed
        );

        scene.add(particle);

        const startTime = Date.now();
        const particleData = {
            mesh: particle,
            geometry: particleGeometry,
            material: particleMaterial,
            velocity: velocity,
            startTime: startTime,
        };

        this.particles.push(particleData);
    }

    update(deltaTime = 0.016 /* approx 60fps */) {
        const now = Date.now();

        // Emit new particles based on emission rate
        const emitInterval = 1000 / this.particleSettings.emissionRate;
        if (now - this.lastEmitTime > emitInterval && this.particles.length < this.particleSettings.count) {
            this.emitParticle();
            this.lastEmitTime = now;
        }

        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const pData = this.particles[i];
            const elapsedTime = now - pData.startTime;

            if (elapsedTime > this.particleSettings.lifetimeMs) {
                // Remove particle
                if (pData.mesh.parent) this.mainScene.scene.remove(pData.mesh);
                pData.geometry.dispose();
                pData.material.dispose();
                this.particles.splice(i, 1);
            } else {
                // Update position (simple movement, could be more complex)
                pData.mesh.position.addScaledVector(pData.velocity, deltaTime);
                // Fade out
                let opacity = 0.7;
                if (elapsedTime > this.particleSettings.lifetimeMs * 0.75) {
                    const fadeProgress = (elapsedTime - this.particleSettings.lifetimeMs * 0.75) / (this.particleSettings.lifetimeMs * 0.25);
                    opacity = 0.5 * (1 - fadeProgress);
                    pData.material.opacity = Math.max(0, opacity);
                }
            }
        }
    }

    // Call this when the parent object (bullet) is destroyed
    destroy() {
        this.particles.forEach(pData => {
            if (pData.mesh.parent) this.mainScene.scene.remove(pData.mesh);
            pData.geometry.dispose();
            pData.material.dispose();
        });
        this.particles = [];
    }

    // Methods to control the emitter if needed
    activate() {
        // Logic to start emitting, if it was paused
    }

    deactivate() {
        // Logic to stop emitting without destroying existing particles immediately
    }
}

export class LineTrail {
    mainScene;
    trailLine;
    trailPoints = [];
    color = 0xff0000;  // bright red
    lineWidth = 15;     // line width for Line2
    opacity = 1.0;

    constructor(mainScene, options = {}) {
        this.mainScene = mainScene;
        Object.assign(this, options);

        // Create the Line2 object once
        const geometry = new LineGeometry();
        geometry.setPositions([
            0,0,0,
            0,3,0,
          ]);
        const material = new LineMaterial({
            color: this.color,
            linewidth: this.lineWidth,
            transparent: true,
            opacity: this.opacity,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            worldUnits: false,
            vertexColors: false
        });

        this.trailLine = new Line2(geometry, material);
    }

    // update() {
    //     if (!this.parentObject) return;

    //     const position = new THREE.Vector3();
    //     this.parentObject.getWorldPosition(position);
    //     this.trailPoints.push(position.clone());


    //     // Need at least 2 points to draw a line
    //     if (this.trailPoints.length < 2) return;

    //     // Update the geometry with all trail points
    //     const positions = [];
    //     for (const point of this.trailPoints) {
    //         positions.push(point.x, point.y, point.z);
    //     }
    //     this.trailLine.geometry.setPositions(positions);
    // }

    destroy() {
        if (this.trailLine) {
            this.mainScene.scene.remove(this.trailLine);
            this.trailLine.geometry.dispose();
            this.trailLine.material.dispose();
            this.trailLine = null;
        }
    }
} 