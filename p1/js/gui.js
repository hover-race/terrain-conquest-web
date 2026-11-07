import { assetPath } from './util.js';

export const guiState = new Proxy({}, {
    get: (target, prop) => {
        if (target[prop] === undefined) {
            console.warn("Unknown property:", prop, target[prop]);
            console.log("Known properties:", Object.keys(target));
        }
        return target[prop] ?? 10;
    }
});

guiState.fps = 60;
guiState.latestChange = '';

let datGuiInstance = null;

export async function setupDatGUI(physics = null, bloomPass = null) {
    const response = await fetch(assetPath(`/p1/version.txt?t=${Date.now()}`));
    guiState.latestChange = (await response.text()).trim();

    if (!datGuiInstance) {
        datGuiInstance = new dat.GUI({ width: 420 });
        datGuiInstance.domElement.style.display = 'none';
        if (datGuiInstance.domElement.parentElement) {
            datGuiInstance.domElement.parentElement.style.zIndex = '10090';
        }
    }

    const gui = datGuiInstance;

    gui.add(guiState, 'latestChange').name('Latest Change').listen();

    if (physics) {
        guiState.debugPhysics = false;
        gui.add(guiState, 'debugPhysics')
            .name('Debug Physics')
            .onChange((value) => {
                if (value) {
                    physics.debug?.enable();
                } else {
                    physics.debug?.disable();
                }
            });
    }

    if (bloomPass) {
        const bloomFolder = gui.addFolder('Bloom Effects');

        guiState.bloomStrength = 1.5;
        guiState.bloomRadius = 0.4;
        guiState.bloomThreshold = 0.85;

        bloomFolder.add(guiState, 'bloomStrength', 0, 3, 0.01)
            .name('Bloom Strength')
            .onChange((value) => {
                bloomPass.strength = value;
            });

        bloomFolder.add(guiState, 'bloomRadius', 0, 2, 0.01)
            .name('Bloom Radius')
            .onChange((value) => {
                bloomPass.radius = value;
            });

        bloomFolder.add(guiState, 'bloomThreshold', 0, 1, 0.01)
            .name('Bloom Threshold')
            .onChange((value) => {
                bloomPass.threshold = value;
            });

        bloomFolder.open();
    }

    gui.add(guiState, 'fps', 0, 100, 0.1)
        .name('FPS')
        .listen();

    const rtsFolder = gui.addFolder('1');
    addParam(rtsFolder, 'rtsZoomSpeed', 0.01, 0.1);
    addParam(rtsFolder, 'rtsCameraDistance', 5, 100);
    addParam(rtsFolder, 'recoilMagnitude', 1, 1000);
    rtsFolder.open();

    const gunCameraFolder = gui.addFolder('Gun Camera');
    addParam(gunCameraFolder, 'gunMouseSensitivity', 0.0001, 0.01, 0.002);
    gunCameraFolder.open();
}

function addParam(folder, paramName, min, max, defaultValue = (min + max) / 2) {
    const range = max - min;
    const step = Math.max(range * 0.01, 0.001);
    guiState[paramName] = defaultValue;
    folder.add(guiState, paramName, min, max, step).name(paramName);
}

document.addEventListener('keydown', (event) => {
    if (event.key === '`') {
        if (datGuiInstance) {
            datGuiInstance.domElement.style.display =
                datGuiInstance.domElement.style.display === 'none' ? 'block' : 'none';
        }
    }
});
