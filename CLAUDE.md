# GPS Map Camera — working notes

A vanilla TypeScript + Vite PWA, used mostly as an **installed iPhone web app**, that takes
GPS-stamped photos for FBR (Pakistan) sales tax registration. It's deployed to Netlify from `main`.

Almost every bug in this project's history was an **iOS WebKit / installed-PWA quirk** rather
than a logic error, and several were "fixed" more than once by guessing. Read the pitfalls below
before touching layout, sensors, haptics, the flash or the service worker.

For iOS PWA problems, check the sibling repo `../stocky/arbia-mobile` and
`../stocky/packages/mobile-theme/theme.css` first. They hold device-tested fixes with long comments.

## Commands

```bash
npm run dev     # https://<LAN-IP>:5173 (self-signed HTTPS, needed for camera/GPS on a phone)
npm run build   # tsc --noEmit && vite build (also what Netlify runs)
npm run icons   # regenerate all icons from public/logo.svg
```

`.env` holds `VITE_GOOGLE_MAPS_API_KEY`. It isn't committed; on Netlify it's an environment variable.

## Files

| File | What it owns |
|---|---|
| `src/main.ts` | All UI wiring: camera, capture, photo frame/crop, gallery, viewer, settings, permissions, updates |
| `src/stamp.ts` | Draws the stamp on a canvas. **One renderer for both the live preview and the saved photo.** Two styles: `modern` (default) and `classic` |
| `src/map.ts` | Map image: Google Static Maps, falling back to Esri/CARTO tiles |
| `src/geo.ts` | GPS watch, reverse geocoding (Google → Nominatim), compass + motion permission |
| `src/orientation.ts` | Physical device rotation (0/90/180/270) relative to the page |
| `src/exif.ts` | EXIF/GPS metadata via piexifjs (with OffsetTime tags patched in) |
| `src/zoom.ts` | Pinch/pan/double-tap zoom in the viewer |
| `src/haptics.ts`, `src/sound.ts` | Haptics (Android Vibration API / iOS switch trick) and the synthesised shutter sound |
| `src/demo.ts` | The procedural "JY & Sons" storefront on the landing screen |
| `src/store.ts` | IndexedDB photos + localStorage settings |
| `netlify.toml` | Build settings + cache headers (required for auto-update) |

## The stamp

- The **Classic** style reproduces a photo FBR actually accepted (measured from a 960×1280
  reference). **Modern** reproduces a second reference (880 wide). Sizes scale with
  `min(W, H) / REF`, so layouts hold at any resolution and in landscape.
- Margins and type sizes were tuned to the user's reference photos. Don't "improve" them
  without being asked. A wider-margin change was reverted.
- Preview and photo must match (WYSIWYG). `photoFrame()` in `main.ts` defines the photo area
  (the viewfinder minus the status-bar strip). `layoutOverlay()` and `capture()` both use it,
  and the capture crop maps that exact screen rect back into video pixels (the viewfinder is
  `object-fit: cover`). Change one, change both.
- `controlsInset()` shifts the **preview** stamp away from the top buttons when the phone is
  turned sideways with the UI locked to portrait. **Never apply it to the saved photo.** It
  once put a ~150px gap in saved photos.

## iOS / PWA pitfalls (all learned the hard way)

1. **Chin gap.** With `viewport-fit=cover` + `black-translucent`, iOS lays out an installed app
   ~59px shorter than the screen. Fix (same as arbia-mobile): `html, body { height: 100vh }`
   only under `@media (display-mode: standalone)`, `100%` otherwise, and full-screen elements
   are `position: absolute` against `body`, **never `position: fixed`**. Symptoms when broken:
   the shutter row is clipped, with a dead strip under it. Don't replace this with JS
   measuring or `100dvh`.
2. **iOS ignores `orientation` in the manifest.** The page itself rotates, so there's a
   landscape layout (side rails) in `style.css`. `orientation.ts` reports device angle minus
   screen angle, so a rotated page doesn't rotate photos twice. With Portrait Orientation Lock
   on, the page stays portrait and the stamp and icons rotate instead.
3. **Motion permission (`DeviceOrientationEvent.requestPermission`) must be the very first
   thing in a real tap.** Nothing may run before it in that tap, especially the synthetic
   haptic click: it uses up the tap's user activation and iOS then refuses without asking.
   Buttons that request it carry `data-haptic="none"`. Taps on non-button elements (the
   viewfinder) don't count as gestures on iOS. The request comes from Start or the rotate
   icon only, never from capture.
4. **Haptics on iOS** are a trick: clicking a hidden `<input type=checkbox switch>`. It only
   works inside a tap, and iOS 18+ only. The shutter is a `<label>` wrapping a real switch
   (capture runs on its `change` event) so the user's own tap toggles it natively. **Never
   fire haptics from scroll or other non-gesture handlers**: it mutates the DOM mid-momentum
   and broke swiping in the viewer.
5. **Torch / flash.** iOS reports torch capability late, so don't gate the button on
   `getCapabilities()` at startup. The user wants flash **only for the shot**: torch on, wait
   ~1s (LED and exposure settle; 0.6s was too short), grab the next video frame, torch off.
   Android without a torch falls back to `ImageCapture.takePhoto({fillLightMode:'flash'})`.
6. **`backdrop-filter` is fragile in WebKit.**
   - It's painted over screens that cover it. The camera's status-bar blur smeared the
     viewer's title. `visibility: hidden` on the camera didn't stop it, and `display: none` on
     the camera broke its layout and blur on return. What works is `updateCovered()` in
     `main.ts`: remove only the `.status-blur` element while Photos or the viewer is open, and
     insert a **fresh** one when the camera is visible again.
   - On a `::before` pseudo-element, or when re-shown after hiding, the blur can come back
     dead. Keep it a real element inside `.stage`, recreated rather than toggled.
   - Don't put it on header bars or buttons that sit on solid backgrounds; it made text and
     icons blurry.
7. **Transform animations** on full-screen panels make iOS rasterise their text at low
   resolution. Panels fade in with opacity only.
8. **Camera stream shape.** The app requests 4K 16:9 (3840×2160). In portrait that's ~9:16,
   the shape of the full-height viewfinder, so the crop keeps nearly all pixels.
9. **Viewer performance.** Only the current photo and its neighbours get full-resolution
   `src`s (`loadNearby`); the rest show thumbnails. Zoom locks horizontal swiping while > 1×.

## Updates and deploys

- The service worker uses `registerType: 'prompt'`. `main.ts` checks for updates on foreground,
  every 30 minutes, on reconnect and when Settings opens. It applies an update at a safe moment
  (not mid-capture or in a dialog) and reloads.
- `netlify.toml` must keep `Cache-Control: no-cache` on `sw.js`, `index.html` and the manifest.
- **Settings shows `Version <commit> · built …`.** When someone reports a fix "not working",
  first confirm the phone is on the expected version. Stale installs caused false "still
  broken" reports more than once.
- Netlify's free-plan "Powered by Netlify" badge is injected by Netlify, not by this code. Turn
  it off in Project configuration → General → Powered by Netlify badge, then **redeploy**: the
  service worker's precached `index.html` still contains the injected script until a new build
  is published.

## Verifying changes

- Headless Chrome can't run in narrow windows, so screenshot phone layouts through an iframe
  harness (390×844, `--force-device-scale-factor=2`). Use
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`; set
  `localStorage['gps-map-camera:started']='1'` to skip the landing screen. Delete harness files
  before committing.
- Headless can't show safe areas, `backdrop-filter` over video, GPS, the torch or haptics. Say
  so instead of claiming those are verified; the real check is the user's iPhone.

## Working with the user

- They test on an iPhone (installed PWA) and send screenshots; requests are short and iterative.
- When a request is ambiguous (layout direction, "blur"), ask with concrete options, using
  previews, rather than guessing. Several guesses had to be reverted.
- Keep the UI simple: no lens or mode selectors and no extra camera features unless asked.
- Commit and push each finished change; Netlify deploys `main`.
