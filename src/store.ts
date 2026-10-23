import { createStore, del, entries, set } from 'idb-keyval'
import type { PhotoRecord, Settings } from './types'

const photos = createStore('gps-map-camera', 'photos')

export const savePhoto = (p: PhotoRecord) => set(p.id, p, photos)
export const deletePhoto = (id: string) => del(id, photos)

export async function listPhotos(): Promise<PhotoRecord[]> {
  const all = await entries<string, PhotoRecord>(photos)
  return all.map(([, v]) => v).sort((a, b) => b.createdAt - a.createdAt)
}

const SETTINGS_KEY = 'gps-map-camera:settings'

export const DEFAULT_SETTINGS: Settings = {
  businessName: '',
  ntn: '',
  note: 'Captured by GPS Map Camera',
  mapStyle: 'satellite',
  quality: 0.92,
  shutterSound: true,
  stampStyle: 'modern',
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Private mode / storage full: settings just won't persist.
  }
}
