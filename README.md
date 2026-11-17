# Traffic Racer 3D

A small browser-based 3D highway racer built with Three.js. It runs as a static site and loads Three.js from jsDelivr.

## Run it

Because the game uses JavaScript modules, serve the repository over HTTP rather than opening `index.html` directly:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Any static web server works. WebGL and an internet connection (for Three.js and the optional display fonts) are required.

## Controls

- **A / D** or **← / →**: steer
- **Space**: drift (steer while holding to slide)
- **Shift**: nitro boost (recharges when not in use)
- **N** or the sun/moon button: switch day/night
- **♫**: mute/unmute synthesized engine and effects
- **Touch screens**: use the left/right, drift, and nitro buttons

## Included

- Procedural 3D cars, asphalt texture, highway markings, roadside buildings, trees, and street lighting
- Day/night lighting with headlights and street lamps
- Traffic collisions, sparks, camera impact, and crash screen
- Drift scoring, nitro, mobile touch controls, synthesized engine and sound effects
