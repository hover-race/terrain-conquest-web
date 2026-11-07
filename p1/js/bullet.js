import { LineTrail } from './particles.js'
import { createExplosion, createDustyExplosion } from './particles.js'
import { glowingOrangeMaterial } from './materials.js'

export class Bullet {
    mesh;
    body;
    mainScene;
    initialVelocity;
    hasExploded = false;
    collisionListener;
    damage = 4;
    trailEmitter;
    lineTrail;
    boundUpdate;
    destroyTimeout;
    glowLight; // Add property for the glow light
    ttlTimeout;

    constructor(mainScene, originObject, shootSpeed = 75) {
        this.mainScene = mainScene;
        const bulletRadius = 0.2;
        const bulletMass = 1;

        // 1. Get position and direction from the originObject
        const position = new THREE.Vector3();
        const direction = new THREE.Vector3();
        originObject.getWorldPosition(position);
        originObject.getWorldDirection(direction);
       
        // First create the mesh, no body yet
        this.mesh = mainScene.add.capsule(
            { radius: bulletRadius, length: bulletRadius * 20, x: position.x, y: position.y, z: position.z, mass: bulletMass, bufferGeometry: true,  },
            
        );
        this.mesh.material = glowingOrangeMaterial;

        // Add point light for additional glow
        this.glowLight = new THREE.PointLight(0xffaa00, 2, 8);
        this.glowLight.position.set(0, 0, 0);
        this.mesh.add(this.glowLight);

        // Set rotation - must do this before adding to physics
        // Orient bullet to face the same direction as originObject
        const q = new THREE.Quaternion();
        originObject.getWorldQuaternion(q);
        
        // Rotate capsule so long axis is forward (capsules are created vertically by default)
        const capsuleRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        q.multiply(capsuleRotation);
        this.mesh.quaternion.copy(q);

        mainScene.physics.add.existing(this.mesh, 
            {
                shape: 'capsule',
                mass: bulletMass,
                radius: bulletRadius,
                length: bulletRadius * 6,
                collisionFlags: 4
            });

        this.body = this.mesh.body;
        
        // Set up CCD (Continuous Collision Detection)
        if (this.body && this.body.ammo) {
            this.body.ammo.setCcdMotionThreshold(0.0001);
            this.body.ammo.setCcdSweptSphereRadius(bulletRadius * 0.25);
        }

        // 3. Calculate initial velocity and apply it
        this.initialVelocity = direction.multiplyScalar(shootSpeed);
        this.body.ammo.setLinearVelocity(new Ammo.btVector3(this.initialVelocity.x, this.initialVelocity.y, this.initialVelocity.z));

        // 4. Setup collision handling
        this.setupCollisionListener(this.mesh, glowingOrangeMaterial);

        // 7. Setup TTL timeout for dusty explosion

        // Raycast to find distance to terrain
        const terrainDistance = this.calculateTerrainDistance(position, direction);
        if (terrainDistance !== null && terrainDistance > 10) {
            const bulletTravelTime = terrainDistance / shootSpeed;
            const ttlMs = bulletTravelTime * 1000;
            console.log('bulletTravelTime', bulletTravelTime);
            
            this.ttlTimeout = setTimeout(() => {
                if (!this.hasExploded) {
                    console.log('Bullet TTL expired - creating dusty explosion');
                    const bulletPosition = new THREE.Vector3();
                    this.mesh.getWorldPosition(bulletPosition);
                    const upwardNormal = new THREE.Vector3(0, 1, 0);
                    createDustyExplosion(this.mainScene, bulletPosition, upwardNormal);
                    this.cleanup(this.mesh.geometry, glowingOrangeMaterial);
                }
            }, ttlMs);
        }

        // 8. Setup fallback timeout to destroy bullet after 5 seconds
        this.destroyTimeout = setTimeout(() => {
            if (!this.hasExploded) {
                console.log('Bullet timeout - destroying');
                this.cleanup(this.mesh.geometry, glowingOrangeMaterial);
            }
        }, 5000);

        // 9. Subscribe to game loop update
        // if (window.pubsub && typeof window.pubsub.addEventListener === 'function') {
        //     this.boundUpdate = this.update.bind(this);
        //     window.pubsub.addEventListener('update', this.boundUpdate);
        // } else {
        //     console.warn('window.pubsub not found or addEventListener method is missing. Bullet update will not be called.');
        // }
    }

    calculateTerrainDistance(position, direction) {
        const raycaster = new THREE.Raycaster(position, direction);
        let terrainObjects = [];

        // Get terrain meshes - check both terrain types
        if (this.mainScene.terrain && this.mainScene.terrain.terrainMesh) {
            terrainObjects.push(this.mainScene.terrain.terrainMesh);
        }
        if (this.mainScene.terrain2 && this.mainScene.terrain2.mauiModel) {
            this.mainScene.terrain2.mauiModel.traverse((child) => {
                if (child.isMesh) {
                    terrainObjects.push(child);
                }
            });
        }

        if (terrainObjects.length > 0) {
            const intersects = raycaster.intersectObjects(terrainObjects, false);
            if (intersects.length > 0) {
                return intersects[0].distance;
            }
        }

        // Fallback distance if no terrain intersection found
        return null;
    }

    // update(event) {
    //     const deltaTime = event && event.detail && typeof event.detail.deltaTime === 'number' ? event.detail.deltaTime : 0.016;
    //     // this.trailEmitter?.update(deltaTime);
    //     this.lineTrail?.update();
    // }

    setupCollisionListener(mesh, material) {
        if (!this.body || !this.body.on) {
            console.warn("Bullet body or event system not available for collision listener.");
            return;
        }

        this.collisionListener = (otherObject, event) => {
            if (this.hasExploded) return;

            // Check if the other object is a target
            if (otherObject.userData && otherObject.userData.isTarget) {
                const targetInstance = otherObject.userData.class;
                if (targetInstance && typeof targetInstance.takeDamage === 'function') {
                    targetInstance.takeDamage(this.damage); // Deal 1 damage to the target
                }
            }

            this.hasExploded = true; // Ensure bullet explodes only once and after damage dealing

            let contactPoint = new THREE.Vector3();
            let contactNormal = new THREE.Vector3(0, 1, 0);

            if (event && event.contacts && event.contacts.length > 0) {
                const firstContact = event.contacts[0];
                if (firstContact.bi === this.body.id) {
                    contactPoint.set(firstContact.rb.x, firstContact.rb.y, firstContact.rb.z);
                    contactNormal.set(firstContact.normalB.x, firstContact.normalB.y, firstContact.normalB.z).normalize();
                } else if (firstContact.ai === this.body.id) {
                    contactPoint.set(firstContact.ra.x, firstContact.ra.y, firstContact.ra.z);
                    contactNormal.set(firstContact.normalA.x, firstContact.normalA.y, firstContact.normalA.z).normalize().negate();
                }
            } else {
                this.mesh.getWorldPosition(contactPoint);
            }

            createExplosion(this.mainScene, contactPoint, contactNormal); // Call the global function
            this.cleanup(mesh.geometry, material);
            console.log('Bullet destroyed');
        };

        this.body.on.collision(this.collisionListener);
    }

    cleanup(geometry, material) {
        if (this.boundUpdate && window.pubsub && typeof window.pubsub.removeEventListener === 'function') {
            window.pubsub.removeEventListener('update', this.boundUpdate);
            this.boundUpdate = null;
        }

        // if (this.trailEmitter) {
        //     this.trailEmitter.destroy();
        //     this.trailEmitter = null;
        // }

        if (this.lineTrail) {
            this.lineTrail.destroy();
            this.lineTrail = null;
        }

        // Clean up glow light
        if (this.glowLight) {
            if (this.mesh) {
                this.mesh.remove(this.glowLight);
            }
            this.glowLight.dispose();
            this.glowLight = null;
        }

        if (this.body) {
            this.mainScene.physics.destroy(this.body);
            this.body = null;
        }
        if (this.mesh && this.mesh.parent) {
            this.mainScene.scene.remove(this.mesh);
            this.mesh = null;
        }
        if (geometry) geometry.dispose();
        if (geometry.body) geometry.body.dispose();
        if (material) material.dispose();

        // Clear the timeout
        clearTimeout(this.destroyTimeout);
        clearTimeout(this.ttlTimeout);
    }
} 