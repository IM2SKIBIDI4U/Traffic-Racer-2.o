# Traffic Racer 3D

A browser-based Three.js highway racer with four lanes, a car garage, traffic modes, brake and auto-acceleration controls, nitro, day/night, sound, and touch controls.

## Run locally
Serve the files over HTTP because the game uses JavaScript modules:

```bash
python -m http.server 8000
```

Open http://localhost:8000. WebGL and internet access for the Three.js CDN are required.

## Controls
- A/D or left/right arrows: steer
- W/up arrow: accelerate when auto acceleration is off
- S/down arrow: brake
- Space: drift while steering
- Shift: nitro
- N or the sun/moon button: switch day/night
- AUTO button: toggle automatic acceleration
- Garage button: buy/select cars and choose one-way or two-way traffic
- Touch controls are available on small screens

Credits, owned cars, selected car, traffic mode, and auto-acceleration preference are saved in local browser storage.
