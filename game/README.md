# City Driver — bird's-eye mobile game

A tiny, self-contained top-down (bird's-eye) open-world driving game in the
spirit of classic GTA. One file, no build step, no dependencies — it runs in
any modern mobile or desktop browser.

## Play

Open `game/index.html` in a browser. On a phone, just open the file (or serve
the folder) and tap **TAP TO PLAY**.

To serve it locally:

```bash
cd game
python3 -m http.server 8080
# then open http://<your-ip>:8080 on your phone (same Wi-Fi)
```

## Controls

**Touch (mobile):**
- Left **stick** — move / steer.
- **ENTER** — get in the nearest car / get out.
- **BRAKE** — slow down / reverse.

**Keyboard (desktop):**
- **WASD** or **arrow keys** — move / drive.
- **E** — enter / exit a car.
- **Space** — brake.

## Goal

Steal a car, drive fast, and rack up **cash**:
- Speeding and drifting pay out over time.
- Grand theft auto, hit-and-runs and combos pay more — but each raises your
  **wanted** level (★).
- Cops chase you once you have stars. Stay close to them too long and you get
  **BUSTED** (game over). Lose the heat by staying out of trouble and your
  stars decay.

Your best cash score is saved locally between runs.

## How it works

Everything lives in `index.html`:
- A grid **city** of roads + buildings generated procedurally.
- Simple **car physics** (accel / drag / speed-scaled steering / handbrake).
- **AI traffic** that follows lanes and turns at intersections, wandering
  **pedestrians** that panic and flee, and **police** that spawn per wanted
  star and chase the player.
- Circle-vs-rectangle **collision**, particles, skid marks, a **minimap**, and
  a mobile-first HUD with on-screen touch controls.
