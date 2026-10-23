import type { MapStyle } from './types'

const TILE = 256
const SIZE = 640 // rendered map canvas, scaled to the stamp's map square
const ZOOM = 18 // ~0.5 m/px in Lahore → the square covers roughly 320 m

const TILE_URL: Record<MapStyle, (z: number, x: number, y: number) => string> = {
  satellite: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  street: (z, x, y) => `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`,
}

const TILE_ATTRIBUTION: Record<MapStyle, string> = {
  satellite: '© Esri',
  street: '© OSM © CARTO',
}

export interface MapImage {
  canvas: HTMLCanvasElement
  /** Text to print over the map; empty when the provider (Google) draws its own logo. */
  attribution: string
  /** Ground metres per canvas pixel. */
  metersPerPixel: number
}

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Google Static Maps at zoom Z-1 / scale 2 has the same ground resolution as a tile mosaic at zoom Z.
const googleUrl = (lat: number, lon: number, style: MapStyle) =>
  `https://maps.googleapis.com/maps/api/staticmap?center=${lat.toFixed(6)},${lon.toFixed(6)}&zoom=${ZOOM - 1}&size=${SIZE / 2}x${SIZE / 2}&scale=2&maptype=${style === 'satellite' ? 'satellite' : 'roadmap'}&key=${GOOGLE_KEY}`

const tileCache = new Map<string, Promise<HTMLImageElement | null>>()

function loadTile(url: string) {
  let p = tileCache.get(url)
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => {
        tileCache.delete(url)
        resolve(null)
      }
      img.src = url
    })
    tileCache.set(url, p)
  }
  return p
}

function project(lat: number, lon: number, z: number) {
  const scale = TILE * 2 ** z
  const sin = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  }
}

function metersPerPixel(lat: number, z = ZOOM) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}

/** Renders a north-up base map centred on the coordinate (pin and overlays are drawn by the stamp). */
export async function renderMap(lat: number, lon: number, style: MapStyle): Promise<MapImage> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = style === 'satellite' ? '#2a3324' : '#e9e5dc'
  ctx.fillRect(0, 0, SIZE, SIZE)

  const google = GOOGLE_KEY ? await loadTile(googleUrl(lat, lon, style)) : null
  if (google) ctx.drawImage(google, 0, 0, SIZE, SIZE)
  else await drawTiles(ctx, lat, lon, style)
  return { canvas, attribution: google ? '' : TILE_ATTRIBUTION[style], metersPerPixel: metersPerPixel(lat) }
}

/** Fallback when there is no Google key or the Static Maps request fails. */
async function drawTiles(ctx: CanvasRenderingContext2D, lat: number, lon: number, style: MapStyle) {
  const c = project(lat, lon, ZOOM)
  const left = c.x - SIZE / 2
  const top = c.y - SIZE / 2
  const jobs: Promise<void>[] = []
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + SIZE) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + SIZE) / TILE); ty++) {
      const dx = tx * TILE - left
      const dy = ty * TILE - top
      jobs.push(
        loadTile(TILE_URL[style](ZOOM, tx, ty)).then((img) => {
          if (img) ctx.drawImage(img, dx, dy, TILE, TILE)
        }),
      )
    }
  }
  await Promise.all(jobs)
}

