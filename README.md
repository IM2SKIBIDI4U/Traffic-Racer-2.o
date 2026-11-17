# Traffic Racer 3D

A browser-based Three.js highway racer with a persistent car garage, credits, day/night lighting, nitro, drifting, sound, and mobile controls.

## Run
Serve the repository over HTTP because the game uses JavaScript modules:

```bash
python -m http.server 8000
```

Open http://localhost:8000. WebGL and internet access for the Three.js CDN are required.

## Controls
- A/D or arrow keys: steer
- Space: drift while steering
- Shift: nitro boost
- N or the sun/moon button: switch day/night
- Garage button: buy/select cars and choose one-way or two-way traffic
- Mobile: use the touch controls

## Garage and modes
Earn credits based on distance traveled; credits and purchased cars are saved in the browser. Buy and select six cars in the garage. One-way mode puts traffic in your direction; two-way mode adds oncoming traffic and double-yellow center markings. The player car is created as the scene loads and remains visible on the road behind the menu/garage.

The road and terrain segments recycle continuously so the highway has no end.
