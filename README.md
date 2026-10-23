# GPS Map Camera

A simple installable PWA that takes geo-tagged photos for FBR sales tax registration (IRIS, Form 14(1)): business premises, machinery and electricity/gas meters.

Each photo gets:

- **A visible stamp** in the format FBR has accepted: a satellite map with a pin, `City,Province,Country 🇵🇰`, street address, `Lat …, Long …`, `Friday, 23/10/2026 06:50 PM GMT+05:00` and a note.
- **EXIF metadata**: GPS latitude/longitude, accuracy, altitude, heading, GPS UTC timestamp, `DateTimeOriginal` with timezone offset, and a description containing the business name, NTN and address.

Photos stay on the device (IndexedDB). **Export** opens the native share sheet (Save to Photos, Files, AirDrop, email), or downloads the files where sharing isn't supported.

> Upload the original JPEGs to IRIS. WhatsApp and some other apps strip GPS metadata.

## Setup

```bash
cp .env.example .env   # add your Google Maps key (Static Maps + Geocoding APIs)
npm install
npm run dev            # https://<your-LAN-IP>:5173 — open on your phone
npm run build          # production build in dist/
```

Camera and GPS require HTTPS. The dev server uses a self-signed certificate, so accept the browser warning once.

Restrict the Google key by HTTP referrer in Google Cloud Console. It ships in the client bundle.
Without a key, the app falls back to Esri/CARTO map tiles and OpenStreetMap Nominatim for addresses.

## Updates

The installed app updates itself. It checks for a new build when it comes to the foreground, every 30 minutes while open, and when the phone reconnects. A new version is applied automatically when the user isn't mid-capture or in a dialog, and the app shows "Updated to the latest version" afterwards.

When hosting, serve `sw.js` (and `index.html`) with `Cache-Control: no-cache` so phones can see new versions. Hashed files under `assets/` can be cached forever.
