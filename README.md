# Traffic Racer 3D

## Driving changes
- Four lane centers are aligned to the lane markings. In two-way mode the left two lanes are oncoming and the right two lanes travel with the player; traffic is never placed on the center divider.
- Added brake controls: **S / Down Arrow** or the mobile **BRAKE** button.
- Added an **AUTO: ON/OFF** option. With auto acceleration off, press **W / Up Arrow** to accelerate; braking and steering continue to work normally.
- Acceleration now starts from zero, uses the selected car's stats, and includes coasting and braking. The speed camera FOV, lower high-speed viewpoint, and road motion streaks make faster speeds feel faster instead of only changing the number on the HUD.

## Run
Serve the repository over HTTP (the game imports Three.js as a browser module): `python -m http.server 8000`, then open http://localhost:8000.
