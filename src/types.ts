export interface Fix {
  lat: number
  lon: number
  accuracy: number
  altitude: number | null
  speed: number | null
  timestamp: number
}

export interface Place {
  title: string // "Lahore, Punjab, Pakistan"
  address: string // street-level address
  countryCode: string
}

export type MapStyle = 'satellite' | 'street'

export interface Settings {
  businessName: string
  ntn: string
  note: string
  mapStyle: MapStyle
  quality: number
  shutterSound: boolean
}

export interface StampData {
  fix: Fix | null
  place: Place | null
  heading: number | null
  date: Date
  settings: Settings
}

export interface PhotoRecord {
  id: string
  createdAt: number
  filename: string
  width: number
  height: number
  blob: Blob
  thumb: Blob
  lat: number
  lon: number
  accuracy: number
  address: string
}
