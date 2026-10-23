import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { buildExif, withExif } from './exif'
import { fileStamp, shortDate } from './format'
import { distance, GeoTracker } from './geo'
import { renderMap, type MapImage } from './map'
import { drawStamp } from './stamp'
import { deletePhoto, listPhotos, loadSettings, savePhoto, saveSettings } from './store'
import type { PhotoRecord, Settings, StampData } from './types'

registerSW({ immediate: true })

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const els = {
  welcome: $('welcome'),
  start: $<HTMLButtonElement>('start'),
  install: $<HTMLButtonElement>('install'),
  iosHint: $('iosHint'),
  demo: $<HTMLCanvasElement>('demo'),
  camera: $('camera'),
  stage: $('stage'),
  video: $<HTMLVideoElement>('video'),
  overlay: $<HTMLCanvasElement>('overlay'),
  flash: $('flash'),
  gpsPill: $('gpsPill'),
  flashBtn: $<HTMLButtonElement>('flashBtn'),
  shutter: $<HTMLButtonElement>('shutter'),
  thumbBtn: $<HTMLButtonElement>('thumbBtn'),
  thumbImg: $<HTMLImageElement>('thumbImg'),
  countBadge: $('countBadge'),
  exportBtn: $<HTMLButtonElement>('exportBtn'),
  settingsBtn: $<HTMLButtonElement>('settingsBtn'),
  gallery: $('gallery'),
  grid: $('grid'),
  empty: $('empty'),
  galleryFoot: $('galleryFoot'),
  shareAll: $<HTMLButtonElement>('shareAll'),
  shareAllLabel: $('shareAllLabel'),
  viewer: $('viewer'),
  viewerTitle: $('viewerTitle'),
  viewerImg: $<HTMLImageElement>('viewerImg'),
  vShare: $<HTMLButtonElement>('vShare'),
  vMaps: $<HTMLButtonElement>('vMaps'),
  vDelete: $<HTMLButtonElement>('vDelete'),
  settings: $('settings'),
  sheetBackdrop: $('sheetBackdrop'),
  settingsForm: $<HTMLFormElement>('settingsForm'),
  toast: $('toast'),
}

const state = {
  settings: loadSettings() as Settings,
  stream: null as MediaStream | null,
  map: null as MapImage | null,
  mapAt: null as { lat: number; lon: number; style: string } | null,
  mapBusy: false,
  photos: [] as PhotoRecord[],
  urls: [] as string[],
  current: null as PhotoRecord | null,
  capturing: false,
  compassAsked: false,
  flash: readFlashPref(),
}

function readFlashPref() {
  try {
    return localStorage.getItem('gps-map-camera:flash') === 'on'
  } catch {
    return false
  }
}

const geo = new GeoTracker()

// App icon for the stamp badge.
const badgeIcon = new Image()
badgeIcon.src = '/pwa-192x192.png'
badgeIcon.onload = () => scheduleDraw()
const icon = () => (badgeIcon.complete && badgeIcon.naturalWidth ? badgeIcon : null)

const haptic = (ms = 8) => navigator.vibrate?.(ms)

// ---------------------------------------------------------------------------
// Toast
let toastTimer = 0
function toast(msg: string, ms = 2200) {
  els.toast.textContent = msg
  els.toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), ms)
}

// ---------------------------------------------------------------------------
// Camera (rear camera only — no lens or mode controls by design)
async function startCamera() {
  stopCamera()
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
    })
    els.video.srcObject = state.stream
    await els.video.play().catch(() => {})
  } catch (e) {
    const name = (e as DOMException).name
    toast(name === 'NotAllowedError' ? 'Camera permission denied — enable it in browser settings' : 'Could not open camera', 4000)
  }
}

// ---------------------------------------------------------------------------
// Flash: fires the torch briefly during capture, where the browser exposes it.
const track = () => state.stream?.getVideoTracks()[0]
const torchSupported = () => !!(track()?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch

async function setTorch(on: boolean) {
  const t = track()
  if (!t || !torchSupported()) return false
  try {
    await t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

function renderFlash() {
  els.flashBtn.setAttribute('aria-pressed', String(state.flash))
  els.flashBtn.setAttribute('aria-label', state.flash ? 'Flash on' : 'Flash off')
}

function toggleFlash() {
  if (!torchSupported()) return toast('Flash isn’t available in this browser')
  state.flash = !state.flash
  try {
    localStorage.setItem('gps-map-camera:flash', state.flash ? 'on' : 'off')
  } catch {
    /* ignore */
  }
  renderFlash()
  haptic()
  toast(state.flash ? 'Flash on' : 'Flash off', 1000)
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop())
  state.stream = null
}

function stampData(date = new Date()): StampData {
  return { fix: geo.fix, place: geo.place, heading: geo.heading, date, settings: state.settings }
}

// ---------------------------------------------------------------------------
// Live preview: same renderer as the saved photo, positioned over the visible video frame.
function layoutOverlay() {
  const v = els.video
  const vw = v.videoWidth
  const vh = v.videoHeight
  if (!vw || !vh) return null
  const sw = els.stage.clientWidth
  const sh = els.stage.clientHeight
  const scale = Math.min(sw / vw, sh / vh)
  const w = vw * scale
  const h = vh * scale
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const c = els.overlay
  Object.assign(c.style, { left: `${(sw - w) / 2}px`, top: `${(sh - h) / 2}px`, width: `${w}px`, height: `${h}px` })
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (c.width !== pw || c.height !== ph) {
    c.width = pw
    c.height = ph
  }
  return { pw, ph }
}

function drawOverlay() {
  const size = layoutOverlay()
  if (!size) return
  const ctx = els.overlay.getContext('2d')!
  ctx.clearRect(0, 0, size.pw, size.ph)
  drawStamp(ctx, size.pw, size.ph, stampData(), state.map, icon())
}

let rafPending = false
function scheduleDraw() {
  if (rafPending || els.camera.hidden) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    drawOverlay()
  })
}

// ---------------------------------------------------------------------------
// GPS / map
async function refreshMap(force = false) {
  const f = geo.fix
  if (!f || state.mapBusy) return
  const style = state.settings.mapStyle
  const at = state.mapAt
  // Re-fetch only after moving ~10 m to keep Static Maps usage low; capture re-renders exactly.
  if (!force && at && at.style === style && distance(at, f) < 10) return
  state.mapBusy = true
  try {
    state.map = await renderMap(f.lat, f.lon, style)
    state.mapAt = { lat: f.lat, lon: f.lon, style }
    scheduleDraw()
  } finally {
    state.mapBusy = false
  }
}

function updateGpsPill() {
  const pill = els.gpsPill
  const label = pill.querySelector('span')!
  pill.classList.remove('good', 'bad')
  if (geo.fix) {
    const acc = Math.round(geo.fix.accuracy)
    label.textContent = `GPS ±${acc} m`
    if (acc <= 25) pill.classList.add('good')
  } else if (geo.error) {
    label.textContent = geo.error
    if (geo.error.includes('denied')) pill.classList.add('bad')
  } else {
    label.textContent = 'Locating…'
  }
  els.shutter.classList.toggle('wait', !geo.fix)
}

geo.onChange(() => {
  updateGpsPill()
  refreshMap()
  scheduleDraw()
})

// ---------------------------------------------------------------------------
// Capture
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T) {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

const toBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q))

async function capture() {
  if (state.capturing) return
  if (!state.compassAsked) {
    state.compassAsked = true
    geo.startCompass()
  }
  const v = els.video
  if (!v.videoWidth) return toast('Camera not ready')
  const fix = geo.fix
  if (!fix) return toast('Waiting for GPS — step outside or near a window')

  state.capturing = true
  haptic(15)
  els.shutter.classList.add('busy')
  els.flash.classList.remove('go')
  void els.flash.offsetWidth
  els.flash.classList.add('go')

  // Let exposure settle under the torch before grabbing the frame.
  const flashed = state.flash && (await setTorch(true))
  if (flashed) await new Promise((r) => setTimeout(r, 450))

  try {
    const W = v.videoWidth
    const H = v.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(v, 0, 0, W, H)
    if (flashed) setTorch(false)

    const date = new Date()
    const data = stampData(date)
    // Make the map match the exact capture position.
    const map = await withTimeout(
      renderMap(fix.lat, fix.lon, state.settings.mapStyle).catch(() => state.map),
      5000,
      state.map,
    )
    drawStamp(ctx, W, H, data, map, icon())

    const id = crypto.randomUUID()
    const blob = withExif(canvas.toDataURL('image/jpeg', state.settings.quality), buildExif(data, W, H, id))

    const tc = document.createElement('canvas')
    tc.width = 360
    tc.height = Math.round((H / W) * 360)
    tc.getContext('2d')!.drawImage(canvas, 0, 0, tc.width, tc.height)
    const thumb = await toBlob(tc, 0.75)

    const rec: PhotoRecord = {
      id,
      createdAt: date.getTime(),
      filename: `GPS_${fileStamp(date)}.jpg`,
      width: W,
      height: H,
      blob,
      thumb,
      lat: fix.lat,
      lon: fix.lon,
      accuracy: fix.accuracy,
      address: geo.place?.address ?? '',
    }
    await savePhoto(rec)
    state.photos.unshift(rec)
    updateThumb(true)
    if (fix.accuracy > 50) toast(`Saved — low GPS accuracy (±${Math.round(fix.accuracy)} m)`)
  } catch (e) {
    console.error(e)
    toast('Could not save photo')
  } finally {
    if (flashed) setTorch(false)
    state.capturing = false
    els.shutter.classList.remove('busy')
  }
}

// ---------------------------------------------------------------------------
// Export
const fileOf = (p: PhotoRecord) => new File([p.blob], p.filename, { type: 'image/jpeg', lastModified: p.createdAt })

function download(p: PhotoRecord) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(p.blob)
  a.download = p.filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/** Native share sheet (Save to Photos / Files / AirDrop / email) with a download fallback. */
async function exportPhotos(photos: PhotoRecord[]) {
  if (!photos.length) return toast('No photos to export')
  const files = photos.map(fileOf)
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files })
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') toast('Export failed')
    }
  } else {
    photos.forEach(download)
  }
}

// ---------------------------------------------------------------------------
// Photos
let thumbUrl = ''
function updateThumb(pop = false) {
  const p = state.photos[0]
  if (thumbUrl) URL.revokeObjectURL(thumbUrl)
  thumbUrl = ''
  if (p) {
    thumbUrl = URL.createObjectURL(p.thumb)
    els.thumbImg.src = thumbUrl
  }
  const n = state.photos.length
  els.thumbImg.hidden = !p
  els.countBadge.hidden = !n
  els.countBadge.textContent = String(n)
  els.exportBtn.disabled = !n
  if (pop) {
    els.thumbBtn.classList.remove('pop')
    void els.thumbBtn.offsetWidth
    els.thumbBtn.classList.add('pop')
  }
}

function renderGallery() {
  state.urls.forEach(URL.revokeObjectURL)
  state.urls = []
  els.grid.innerHTML = ''
  for (const p of state.photos) {
    const t = document.createElement('button')
    t.className = 'tile'
    const img = document.createElement('img')
    const url = URL.createObjectURL(p.thumb)
    state.urls.push(url)
    img.src = url
    img.loading = 'lazy'
    img.alt = ''
    const label = document.createElement('span')
    label.textContent = shortDate(p.createdAt)
    t.append(img, label)
    t.onclick = () => openViewer(p)
    els.grid.append(t)
  }
  const n = state.photos.length
  els.empty.hidden = n > 0
  els.galleryFoot.hidden = n === 0
  els.shareAllLabel.textContent = n === 1 ? 'Export photo' : `Export all ${n} photos`
}

function openGallery() {
  renderGallery()
  els.gallery.hidden = false
  history.pushState({ view: 'gallery' }, '')
}

let viewerUrl = ''
function openViewer(p: PhotoRecord) {
  state.current = p
  if (viewerUrl) URL.revokeObjectURL(viewerUrl)
  viewerUrl = URL.createObjectURL(p.blob)
  els.viewerImg.src = viewerUrl
  els.viewerTitle.textContent = shortDate(p.createdAt)
  delete els.vDelete.dataset.armed
  els.viewer.hidden = false
  history.pushState({ view: 'viewer' }, '')
}

// ---------------------------------------------------------------------------
// Settings
function openSettings() {
  const f = els.settingsForm
  const s = state.settings
  ;(f.elements.namedItem('businessName') as HTMLInputElement).value = s.businessName
  ;(f.elements.namedItem('ntn') as HTMLInputElement).value = s.ntn
  ;(f.elements.namedItem('note') as HTMLInputElement).value = s.note
  f.querySelectorAll<HTMLInputElement>('input[name=mapStyle]').forEach((r) => (r.checked = r.value === s.mapStyle))
  els.sheetBackdrop.hidden = false
  els.settings.hidden = false
}

function closeSettings() {
  const f = new FormData(els.settingsForm)
  const prevStyle = state.settings.mapStyle
  state.settings = {
    ...state.settings,
    businessName: String(f.get('businessName') ?? '').trim(),
    ntn: String(f.get('ntn') ?? '').trim(),
    note: String(f.get('note') ?? '').trim(),
    mapStyle: f.get('mapStyle') === 'street' ? 'street' : 'satellite',
  }
  saveSettings(state.settings)
  els.sheetBackdrop.hidden = true
  els.settings.hidden = true
  if (prevStyle !== state.settings.mapStyle) refreshMap(true)
  scheduleDraw()
}

// ---------------------------------------------------------------------------
// Welcome demo: a sample storefront stamped exactly as real photos will be.
function paintStorefront(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.45)
  sky.addColorStop(0, '#8ec5e8')
  sky.addColorStop(1, '#dcebf3')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#e8dcc4'
  ctx.fillRect(W * 0.06, H * 0.1, W * 0.88, H * 0.9)
  ctx.fillStyle = '#d6c7a9'
  for (let i = 0; i < 4; i++) ctx.fillRect(W * (0.12 + i * 0.21), H * 0.17, W * 0.13, H * 0.13)
  ctx.fillStyle = '#0f5132'
  ctx.fillRect(W * 0.1, H * 0.36, W * 0.8, H * 0.12)
  ctx.fillStyle = '#fff'
  ctx.font = `800 ${H * 0.07}px -apple-system, Roboto, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('KHAN TRADERS', W / 2, H * 0.42)
  ctx.textAlign = 'left'
  for (let i = 0; i < 3; i++) {
    const x = W * (0.1 + i * 0.27)
    const g = ctx.createLinearGradient(0, H * 0.5, 0, H)
    g.addColorStop(0, '#9aa3ad')
    g.addColorStop(1, '#6b737c')
    ctx.fillStyle = g
    ctx.fillRect(x, H * 0.5, W * 0.24, H * 0.5)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    for (let y = H * 0.5; y < H; y += H * 0.02) ctx.fillRect(x, y, W * 0.24, H * 0.004)
  }
}

let demoTimer = 0
async function startDemo() {
  const c = els.demo
  const ctx = c.getContext('2d')
  if (!ctx) return
  const lat = 31.481414
  const lon = 74.261938
  const map = await renderMap(lat, lon, 'satellite').catch(() => null)
  const draw = () => {
    paintStorefront(ctx, c.width, c.height)
    drawStamp(
      ctx,
      c.width,
      c.height,
      {
        fix: { lat, lon, accuracy: 8, altitude: null, speed: null, timestamp: Date.now() },
        place: { title: 'Lahore, Punjab, Pakistan', address: 'Syed Kabir Ali Shah Road, Lahore, Punjab, Pakistan', countryCode: 'PK' },
        heading: 215,
        date: new Date(),
        settings: state.settings,
      },
      map,
      icon(),
    )
  }
  draw()
  demoTimer = window.setInterval(draw, 1000)
}

// ---------------------------------------------------------------------------
// Wiring
async function launch() {
  clearInterval(demoTimer)
  els.welcome.hidden = true
  els.camera.hidden = false
  try {
    localStorage.setItem('gps-map-camera:started', '1')
  } catch {
    /* ignore */
  }
  geo.start()
  await startCamera()
}

els.start.onclick = () => {
  state.compassAsked = true
  geo.startCompass()
  launch()
}
els.shutter.onclick = capture
els.flashBtn.onclick = toggleFlash
renderFlash()
els.thumbBtn.onclick = openGallery
els.exportBtn.onclick = () => exportPhotos(state.photos)
els.settingsBtn.onclick = openSettings
els.sheetBackdrop.onclick = closeSettings
els.settingsForm.onsubmit = (e) => {
  e.preventDefault()
  closeSettings()
}
els.shareAll.onclick = () => exportPhotos(state.photos)
els.vShare.onclick = () => state.current && exportPhotos([state.current])
els.vMaps.onclick = () => {
  const p = state.current
  if (p) window.open(`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`, '_blank')
}
els.vDelete.onclick = async () => {
  const p = state.current
  if (!p) return
  if (els.vDelete.dataset.armed !== '1') {
    els.vDelete.dataset.armed = '1'
    toast('Tap Delete again to confirm')
    setTimeout(() => delete els.vDelete.dataset.armed, 3000)
    return
  }
  delete els.vDelete.dataset.armed
  await deletePhoto(p.id)
  state.photos = state.photos.filter((x) => x.id !== p.id)
  updateThumb()
  renderGallery()
  history.back()
}

document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => (b.onclick = () => history.back()))

// Back button / gesture closes the top-most panel.
window.addEventListener('popstate', () => {
  if (!els.viewer.hidden) els.viewer.hidden = true
  else if (!els.gallery.hidden) els.gallery.hidden = true
})

// Install: Android/desktop get the native prompt; iOS needs manual "Add to Home Screen".
type InstallPrompt = Event & { prompt: () => Promise<void> }
let installPrompt: InstallPrompt | null = null
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installPrompt = e as InstallPrompt
  els.install.hidden = false
})
els.install.onclick = async () => {
  await installPrompt?.prompt()
  installPrompt = null
  els.install.hidden = true
}
if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) els.iosHint.hidden = false

els.video.addEventListener('loadedmetadata', scheduleDraw)
window.addEventListener('resize', scheduleDraw)
setInterval(scheduleDraw, 1000) // keep the clock on the preview ticking

document.addEventListener('visibilitychange', () => {
  if (els.camera.hidden) return
  if (document.hidden) stopCamera()
  else startCamera()
})

;(async () => {
  updateGpsPill()
  let started = false
  try {
    started = localStorage.getItem('gps-map-camera:started') === '1'
  } catch {
    /* ignore */
  }
  if (started) launch()
  else startDemo()
  state.photos = await listPhotos().catch(() => [])
  updateThumb()
})()
