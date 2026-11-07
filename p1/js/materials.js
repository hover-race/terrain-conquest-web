import * as THREE from 'three';

// Shared glowing orange material for bullets and muzzle flashes
export const glowingOrangeMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffaa00,    // Orange-gold color
    emissive: 0xffffaa, // Same color for emissive
    emissiveIntensity: 1
});

// Variant for muzzle flash with transparency and double-sided rendering
export const muzzleFlashMaterial = new THREE.MeshStandardMaterial({
    color: 0xffaa00,    // Same orange-gold color
    emissive: 0xffffaa, // Same emissive color
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide
}); 