import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { buildExif, withExif } from './exif'
import { fileStamp, shortDate } from './format'
import { distance, GeoTracker } from './geo'
import { renderMap, type MapImage } from './map'
import { haptic, installButtonHaptics } from './haptics'
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
  galleryTitle: $('galleryTitle'),
  selectBtn: $<HTMLButtonElement>('selectBtn'),
  grid: $('grid'),
  empty: $('empty'),
  galleryFoot: $('galleryFoot'),
  exportAll: $<HTMLButtonElement>('exportAll'),
  exportAllLabel: $('exportAllLabel'),
  selectAllBtn: $<HTMLButtonElement>('selectAllBtn'),
  selCount: $('selCount'),
  deleteSel: $<HTMLButtonElement>('deleteSel'),
  exportSel: $<HTMLButtonElement>('exportSel'),
  viewer: $('viewer'),
  viewerTitle: $('viewerTitle'),
  viewerPos: $('viewerPos'),
  track: $('track'),
  vShare: $<HTMLButtonElement>('vShare'),
  vMaps: $<HTMLButtonElement>('vMaps'),
  vDelete: $<HTMLButtonElement>('vDelete'),
  settings: $('settings'),
  sheetBackdrop: $('sheetBackdrop'),
  settingsForm: $<HTMLFormElement>('settingsForm'),
  toast: $('toast'),
  snack: $('snack'),
  snackText: $('snackText'),
  snackUndo: $<HTMLButtonElement>('snackUndo'),
  ask: $('ask'),
  askBackdrop: $('askBackdrop'),
  askTitle: $('askTitle'),
  askText: $('askText'),
  askActions: $('askActions'),
}

const state = {
  settings: loadSettings() as Settings,
  stream: null as MediaStream | null,
  map: null as MapImage | null,
  mapAt: null as { lat: number; lon: number; style: string } | null,
  mapBusy: false,
  photos: [] as PhotoRecord[],
  urls: new Map<string, string>(), // photo id → object URL (full image)
  thumbs: new Map<string, string>(), // photo id → object URL (thumbnail)
  selecting: false,
  selected: new Set<string>(),
  viewIndex: 0,
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

installButtonHaptics()

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
    haptic('success')
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
// Action sheet: resolves with the chosen action id, or null when dismissed.
interface AskAction {
  id: string
  label: string
  style: 'primary' | 'danger' | 'glass'
}

function ask(title: string, text: string, actions: AskAction[]): Promise<string | null> {
  return new Promise((resolve) => {
    els.askTitle.textContent = title
    els.askText.textContent = text
    els.askActions.innerHTML = ''
    const done = (v: string | null) => {
      els.ask.hidden = true
      els.askBackdrop.hidden = true
      resolve(v)
    }
    for (const a of actions) {
      const b = document.createElement('button')
      b.className = `btn ${a.style}`
      if (a.style === 'danger') b.dataset.haptic = 'warning'
      b.textContent = a.label
      b.onclick = () => done(a.id)
      els.askActions.append(b)
    }
    els.askBackdrop.onclick = () => done(null)
    els.ask.hidden = false
    els.askBackdrop.hidden = false
  })
}

// ---------------------------------------------------------------------------
// Delete with undo: photos disappear immediately; the IndexedDB delete is committed
// after the undo window closes (or right away if the app is backgrounded).
let pending: { photos: PhotoRecord[]; timer: number } | null = null

function commitPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.photos.forEach((p) => {
    deletePhoto(p.id)
    releaseUrls(p.id)
  })
  pending = null
  els.snack.classList.remove('show')
}

function removePhotos(ids: Set<string>) {
  commitPending()
  const removed = state.photos.filter((p) => ids.has(p.id))
  if (!removed.length) return
  state.photos = state.photos.filter((p) => !ids.has(p.id))
  ids.forEach((id) => state.selected.delete(id))
  pending = { photos: removed, timer: window.setTimeout(commitPending, 5000) }
  els.snackText.textContent = removed.length === 1 ? 'Photo deleted' : `${removed.length} photos deleted`
  refreshAll()
  placeSnack()
  els.snack.classList.add('show')
}

/** Float the undo bar just above whichever bottom bar is on screen. */
function placeSnack() {
  const bar = !els.viewer.hidden
    ? els.viewer.querySelector('.viewer-actions')
    : !els.gallery.hidden
      ? els.galleryFoot.hidden
        ? null
        : els.galleryFoot
      : els.camera.hidden
        ? null
        : els.camera.querySelector('.controls')
  const h = bar instanceof HTMLElement ? bar.offsetHeight : 0
  els.snack.style.bottom = h ? `${h + 12}px` : 'calc(16px + env(safe-area-inset-bottom, 0px))'
}

function undoDelete() {
  if (!pending) return
  clearTimeout(pending.timer)
  state.photos = [...state.photos, ...pending.photos].sort((a, b) => b.createdAt - a.createdAt)
  pending = null
  els.snack.classList.remove('show')
  refreshAll()
}

function refreshAll() {
  updateThumb()
  if (!els.gallery.hidden) renderGallery()
  if (!els.viewer.hidden) {
    if (!state.photos.length) history.back()
    else renderViewer(Math.min(state.viewIndex, state.photos.length - 1))
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

/** Native share sheet (Save to Photos / Files / AirDrop / email), with a download fallback.
 *  Afterwards, offers to clear the exported photos out of the app. */
async function exportPhotos(photos: PhotoRecord[]) {
  if (!photos.length) return
  const files = photos.map(fileOf)
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files })
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') toast('Export failed')
      return
    }
  } else {
    photos.forEach(download)
  }
  const n = photos.length
  const choice = await ask(
    n === 1 ? 'Photo exported' : `${n} photos exported`,
    'Remove them from this app to free up space? Your exported copies are not affected.',
    [
      { id: 'remove', label: n === 1 ? 'Remove from app' : `Remove ${n} photos from app`, style: 'danger' },
      { id: 'keep', label: 'Keep', style: 'glass' },
    ],
  )
  if (choice === 'remove') {
    setSelecting(false)
    removePhotos(new Set(photos.map((p) => p.id)))
  }
}

// ---------------------------------------------------------------------------
// Photos
const thumbUrl = (p: PhotoRecord) => {
  let u = state.thumbs.get(p.id)
  if (!u) state.thumbs.set(p.id, (u = URL.createObjectURL(p.thumb)))
  return u
}
const fullUrl = (p: PhotoRecord) => {
  let u = state.urls.get(p.id)
  if (!u) state.urls.set(p.id, (u = URL.createObjectURL(p.blob)))
  return u
}
function releaseUrls(id: string) {
  for (const m of [state.urls, state.thumbs]) {
    const u = m.get(id)
    if (u) URL.revokeObjectURL(u)
    m.delete(id)
  }
}

function updateThumb(pop = false) {
  const p = state.photos[0]
  if (p) els.thumbImg.src = thumbUrl(p)
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

const CHECK = '<span class="check"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>'

function renderGallery() {
  const n = state.photos.length
  if (!n && state.selecting) state.selecting = false
  els.gallery.classList.toggle('selecting', state.selecting)
  els.grid.innerHTML = ''
  for (const p of state.photos) {
    const t = document.createElement('button')
    t.className = 'tile'
    t.classList.toggle('sel', state.selected.has(p.id))
    t.innerHTML = `<img alt="" loading="lazy" src="${thumbUrl(p)}">${CHECK}`
    t.setAttribute('aria-label', shortDate(p.createdAt))
    t.onclick = () => {
      if (!state.selecting) return openViewer(state.photos.indexOf(p))
      if (state.selected.has(p.id)) state.selected.delete(p.id)
      else state.selected.add(p.id)
      t.classList.toggle('sel', state.selected.has(p.id))
      updateSelectionBar()
    }
    els.grid.append(t)
  }
  els.empty.hidden = n > 0
  els.galleryFoot.hidden = n === 0
  els.selectBtn.hidden = n === 0
  els.selectBtn.textContent = state.selecting ? 'Cancel' : 'Select'
  els.exportAllLabel.textContent = n === 1 ? 'Export photo' : `Export all ${n} photos`
  updateSelectionBar()
}

function updateSelectionBar() {
  const k = state.selected.size
  const n = state.photos.length
  els.galleryTitle.textContent = state.selecting ? (k ? `${k} selected` : 'Select photos') : 'Photos'
  els.selCount.textContent = ''
  els.selectAllBtn.textContent = k === n && n > 0 ? 'Deselect all' : 'Select all'
  els.deleteSel.disabled = !k
  els.exportSel.disabled = !k
}

function setSelecting(on: boolean) {
  state.selecting = on
  state.selected.clear()
  if (!els.gallery.hidden) renderGallery()
}

function openGallery() {
  state.selecting = false
  state.selected.clear()
  renderGallery()
  els.gallery.hidden = false
  history.pushState({ view: 'gallery' }, '')
}

// Viewer: one slide per photo, swiped with native scroll-snap.
function renderViewer(index: number) {
  els.track.innerHTML = ''
  for (const p of state.photos) {
    const slide = document.createElement('div')
    slide.className = 'slide'
    const img = document.createElement('img')
    img.alt = ''
    img.loading = 'lazy'
    img.src = fullUrl(p)
    slide.append(img)
    els.track.append(slide)
  }
  state.viewIndex = index
  requestAnimationFrame(() => {
    els.track.scrollTo({ left: index * els.track.clientWidth, behavior: 'instant' as ScrollBehavior })
    updateViewerTitle()
  })
}

function updateViewerTitle() {
  const w = els.track.clientWidth || 1
  const i = Math.max(0, Math.min(state.photos.length - 1, Math.round(els.track.scrollLeft / w)))
  if (i !== state.viewIndex && !els.viewer.hidden) haptic('light')
  state.viewIndex = i
  const p = state.photos[state.viewIndex]
  if (!p) return
  els.viewerTitle.textContent = shortDate(p.createdAt)
  els.viewerPos.textContent = state.photos.length > 1 ? `${state.viewIndex + 1} of ${state.photos.length}` : ''
}

function openViewer(index: number) {
  els.viewer.hidden = false
  renderViewer(index)
  history.pushState({ view: 'viewer' }, '')
}

/** iOS-style confirmation before any delete. */
async function confirmDelete(n: number) {
  const choice = await ask(
    n === 1 ? 'Delete this photo?' : `Delete ${n} photos?`,
    n === 1 ? 'It will be removed from this app.' : 'They will be removed from this app.',
    [
      { id: 'delete', label: n === 1 ? 'Delete Photo' : `Delete ${n} Photos`, style: 'danger' },
      { id: 'cancel', label: 'Cancel', style: 'glass' },
    ],
  )
  return choice === 'delete'
}

async function deleteCurrent() {
  const p = state.photos[state.viewIndex]
  if (!p || !(await confirmDelete(1))) return
  const slide = els.track.children[state.viewIndex] as HTMLElement | undefined
  slide?.classList.add('leaving')
  setTimeout(() => removePhotos(new Set([p.id])), 180)
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
  ctx.fillText('JY & SONS', W / 2, H * 0.42)
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
    // Match the canvas to its on-screen box so the stamp is never cropped.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(c.clientWidth * dpr)
    const h = Math.round(c.clientHeight * dpr)
    if (w && h && (c.width !== w || c.height !== h)) {
      c.width = w
      c.height = h
    }
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
const selectedPhotos = () => state.photos.filter((p) => state.selected.has(p.id))
els.exportAll.onclick = () => exportPhotos(state.photos)
els.selectBtn.onclick = () => setSelecting(!state.selecting)
els.selectAllBtn.onclick = () => {
  if (state.selected.size === state.photos.length) state.selected.clear()
  else state.photos.forEach((p) => state.selected.add(p.id))
  renderGallery()
}
els.deleteSel.onclick = async () => {
  const ids = new Set(state.selected)
  if (!ids.size || !(await confirmDelete(ids.size))) return
  els.grid.querySelectorAll('.tile.sel').forEach((t) => t.classList.add('leaving'))
  setTimeout(() => {
    state.selecting = false
    removePhotos(ids)
  }, 200)
}
els.exportSel.onclick = () => exportPhotos(selectedPhotos())
els.snackUndo.onclick = undoDelete
els.track.addEventListener('scroll', () => requestAnimationFrame(updateViewerTitle), { passive: true })
els.vShare.onclick = () => {
  const p = state.photos[state.viewIndex]
  if (p) exportPhotos([p])
}
els.vDelete.onclick = deleteCurrent
els.vMaps.onclick = () => {
  const p = state.photos[state.viewIndex]
  if (p) window.open(`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`, '_blank')
}
document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => (b.onclick = () => history.back()))

// Back button / gesture closes the top-most panel.
window.addEventListener('popstate', () => {
  if (!els.ask.hidden) {
    els.askBackdrop.click()
  } else if (!els.viewer.hidden) {
    els.viewer.hidden = true
    els.track.innerHTML = ''
    if (!els.gallery.hidden) renderGallery()
  } else if (!els.gallery.hidden) {
    els.gallery.hidden = true
  }
  if (els.snack.classList.contains('show')) placeSnack()
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

// Never lose a pending delete if the app is closed during the undo window.
window.addEventListener('pagehide', commitPending)

document.addEventListener('visibilitychange', () => {
  if (document.hidden) commitPending()
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
