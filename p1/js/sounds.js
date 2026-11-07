// Create an AudioContext (or reuse if one exists)
let audioCtx;
function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playPewSound() {
    const context = getAudioContext();
    if (!context) {
        console.warn("Web Audio API not supported.");
        return;
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    // Connect oscillator to gain node to audio context destination
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    // Sound parameters for an 8-bit feel
    oscillator.type = 'square'; // Square wave for a retro sound

    // Pitch: Start high and quickly drop
    const startTime = context.currentTime;
    oscillator.frequency.setValueAtTime(1200, startTime); // Start frequency
    oscillator.frequency.exponentialRampToValueAtTime(300, startTime + 0.07); // End frequency after 0.07s

    // Volume envelope: Quick attack and decay
    gainNode.gain.setValueAtTime(0.3, startTime); // Initial volume (lower to prevent clipping)
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15); // Fade out over 0.15s

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.15); // Stop the sound after 0.15 seconds
}

export function playExplosionSound() {
    const context = getAudioContext();
    if (!context) {
        console.warn("Web Audio API not supported.");
        return;
    }

    const startTime = context.currentTime;

    // Main explosion oscillator (low frequency)
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth'; // Richer, harsher sound
    oscillator.frequency.setValueAtTime(150, startTime); // Start lower
    oscillator.frequency.exponentialRampToValueAtTime(50, startTime + 0.15); // Shortened ramp duration

    // Noise component for a more chaotic feel
    const bufferSize = context.sampleRate * 0.25; // Shortened noise duration
    const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1; // White noise
    }
    const noiseSource = context.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Lowpass filter for the noise to make it less hissy and more rumbly
    const lowpassFilter = context.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.setValueAtTime(800, startTime); // Cut off frequencies above 800Hz

    // Gain for the main oscillator
    const oscGain = context.createGain();
    oscGain.gain.setValueAtTime(0.15, startTime); // Reduced from 0.4
    oscGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2); // Shortened fade

    // Gain for the noise component
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.35, startTime); // Increased from 0.2
    noiseGain.gain.linearRampToValueAtTime(0.001, startTime + 0.18); // Shortened fade

    // Connections
    oscillator.connect(oscGain);
    oscGain.connect(context.destination);

    noiseSource.connect(lowpassFilter); // Noise to filter
    lowpassFilter.connect(noiseGain);   // Filtered noise to gain
    noiseGain.connect(context.destination);

    // Start and stop sounds
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2); // Shortened stop time

    noiseSource.start(startTime);
    noiseSource.stop(startTime + 0.18); // Shortened stop time
}

export function playFlagCaptureSound() {
    const context = getAudioContext();
    if (!context) {
        console.warn("Web Audio API not supported.");
        return;
    }

    const startTime = context.currentTime;
    
    // Create a trumpet-like fanfare with multiple notes
    const notes = [
        { freq: 523.25, start: 0, duration: 0.15 },    // C5
        { freq: 659.25, start: 0.1, duration: 0.15 },  // E5
        { freq: 783.99, start: 0.2, duration: 0.2 }    // G5
    ];
    
    notes.forEach(note => {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();
        
        // Connect oscillator to gain node to audio context destination
        oscillator.connect(gainNode);
        gainNode.connect(context.destination);
        
        // Use sawtooth wave for a more trumpet-like sound
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(note.freq, startTime + note.start);
        
        // Volume envelope: Quick attack, sustain, then decay
        const noteStart = startTime + note.start;
        gainNode.gain.setValueAtTime(0, noteStart);
        gainNode.gain.linearRampToValueAtTime(0.2, noteStart + 0.02); // Quick attack
        gainNode.gain.setValueAtTime(0.2, noteStart + note.duration * 0.7); // Sustain
        gainNode.gain.exponentialRampToValueAtTime(0.001, noteStart + note.duration); // Decay
        
        oscillator.start(noteStart);
        oscillator.stop(noteStart + note.duration);
    });
} 