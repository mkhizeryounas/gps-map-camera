import type { Fix, Place } from './types'

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

type Listener = () => void

/** Distance in metres between two coordinates (haversine). */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLon = (b.lon - a.lon) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Tracks GPS fix, reverse-geocoded place and compass heading.
 * Network lookups are throttled by distance moved so we stay within free-tier usage policies.
 */
export class GeoTracker {
  fix: Fix | null = null
  place: Place | null = null
  heading: number | null = null
  error: string | null = null

  private listeners = new Set<Listener>()
  private watchId: number | null = null
  private placeAt: { lat: number; lon: number } | null = null
  private placeInFlight = false

  onChange(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.error = 'GPS not supported on this device'
      this.emit()
      return
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords
        this.fix = {
          lat: c.latitude,
          lon: c.longitude,
          accuracy: c.accuracy,
          altitude: c.altitude,
          speed: c.speed,
          timestamp: pos.timestamp,
        }
        this.error = null
        this.emit()
        this.refreshPlace()
      },
      (err) => {
        this.error = err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Searching for GPS…'
        this.emit()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    )
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId)
    this.watchId = null
  }

  /** Must be called from a user gesture on iOS (permission prompt). */
  /** Returns whether orientation access is available (iOS asks for permission). */
  async startCompass() {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    if (DOE?.requestPermission) {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false
      } catch {
        return false
      }
    }
    const handler = (e: DeviceOrientationEvent) => {
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
      let h: number | null = null
      if (typeof ios === 'number') h = ios
      else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360
      if (h != null) this.heading = h
    }
    // Android exposes true-north heading via the "absolute" event; iOS via webkitCompassHeading.
    const event = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(event as 'deviceorientation', handler)
    return true
  }

  private async refreshPlace() {
    const f = this.fix
    if (!f || this.placeInFlight) return
    if (this.placeAt && distance(this.placeAt, f) < 25) return
    this.placeInFlight = true
    try {
      this.place = (GOOGLE_KEY && (await googleReverse(f.lat, f.lon))) || (await nominatimReverse(f.lat, f.lon))
      this.placeAt = { lat: f.lat, lon: f.lon }
      this.emit()
    } catch {
      // Offline or rate-limited: keep the last known place, retry on next fix.
    } finally {
      // Nominatim policy: max 1 request/second.
      setTimeout(() => (this.placeInFlight = false), 1100)
    }
  }

}

interface GoogleComponent {
  long_name: string
  short_name: string
  types: string[]
}

interface GoogleResult {
  formatted_address: string
  address_components: GoogleComponent[]
  types: string[]
}

async function googleReverse(lat: number, lon: number): Promise<Place | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=en&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = await res.json()
  const results: GoogleResult[] = json.results ?? []
  if (json.status !== 'OK' || !results.length) return null
  // Skip plus-code-only results ("F7J6+HQ Lahore") in favour of a street address.
  const best = results.find((r) => !r.types.includes('plus_code')) ?? results[0]
  const own = (type: string) => best.address_components.find((c) => c.types.includes(type))?.long_name ?? ''
  const get = (type: string) =>
    results.flatMap((r) => r.address_components).find((c) => c.types.includes(type))?.long_name ?? ''
  const countryComp = results.flatMap((r) => r.address_components).find((c) => c.types.includes('country'))
  const city = get('locality') || get('administrative_area_level_2')
  const province = get('administrative_area_level_1')
  const title = [city, province, countryComp?.long_name].filter(Boolean).join(', ')
  // "Street, Area, City, Province, Country" — same shape as the accepted reference stamp.
  const street = [own('street_number'), own('route')].filter(Boolean).join(' ')
  const area = own('sublocality_level_1') || own('neighborhood') || own('sublocality')
  const parts = [street, area, city, province, countryComp?.long_name ?? '']
  const address = parts.filter((x, i) => x && !parts.slice(0, i).includes(x)).join(', ')
  return {
    title: title || best.formatted_address,
    address: address || best.formatted_address,
    countryCode: countryComp?.short_name ?? '',
  }
}

async function nominatimReverse(lat: number, lon: number): Promise<Place> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return formatPlace(await res.json())
}

interface NominatimResult {
  display_name?: string
  address?: Record<string, string>
}

function formatPlace(r: NominatimResult): Place {
  const a = r.address ?? {}
  const city = a.city || a.town || a.village || a.municipality || a.county || a.state_district || ''
  const title = [city, a.state, a.country].filter(Boolean).join(', ') || 'Unknown location'
  const street = [a.house_number, a.road].filter(Boolean).join(' ')
  const area = a.neighbourhood || a.suburb || a.quarter || a.residential || ''
  const parts = [street, area, city, [a.state, a.postcode].filter(Boolean).join(' '), a.country]
  // Drop empties and adjacent duplicates ("Lahore, Lahore").
  const address = parts.filter((p, i) => p && p !== parts[i - 1]).join(', ') || r.display_name || title
  return { title, address, countryCode: (a.country_code || '').toUpperCase() }
}

export function cardinal(deg: number) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}
