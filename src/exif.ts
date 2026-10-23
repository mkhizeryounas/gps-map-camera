import piexif from 'piexifjs'
import { exifDateTime, exifOffset } from './format'
import type { StampData } from './types'

// piexifjs predates EXIF 2.31; register the timezone offset tags so dump() can encode them.
const exifTags = piexif.TAGS.Exif
exifTags[36880] ??= { name: 'OffsetTime', type: 'Ascii' }
exifTags[36881] ??= { name: 'OffsetTimeOriginal', type: 'Ascii' }
exifTags[36882] ??= { name: 'OffsetTimeDigitized', type: 'Ascii' }

type Rational = [number, number]

const rational = (v: number, den = 100): Rational => [Math.round(Math.abs(v) * den), den]

function dms(deg: number): Rational[] {
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const mFloat = (a - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return [[d, 1], [m, 1], rational(s, 10000)]
}

/** EXIF ASCII fields must be 7-bit; strip anything else (Urdu script, emoji). */
const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim()

export function buildExif(d: StampData, width: number, height: number, id: string) {
  const dt = exifDateTime(d.date)
  const off = exifOffset(d.date)
  const s = d.settings
  const desc = [
    'Geo-tagged photo',
    s.businessName && `Business: ${s.businessName}`,
    s.ntn && `NTN: ${s.ntn}`,
    d.fix && `GPS: ${d.fix.lat.toFixed(6)}, ${d.fix.lon.toFixed(6)} (+/-${Math.round(d.fix.accuracy)}m)`,
    d.place && `Address: ${d.place.address}`,
    s.note && `Note: ${s.note}`,
  ]
    .filter(Boolean)
    .join(' | ')

  const zeroth: Record<number, unknown> = {
    [piexif.ImageIFD.ImageDescription]: ascii(desc),
    [piexif.ImageIFD.Software]: 'GPS Map Camera (PWA)',
    [piexif.ImageIFD.DateTime]: dt,
    [piexif.ImageIFD.Orientation]: 1,
    [piexif.ImageIFD.XResolution]: [72, 1],
    [piexif.ImageIFD.YResolution]: [72, 1],
    [piexif.ImageIFD.ResolutionUnit]: 2,
  }
  if (s.businessName) zeroth[piexif.ImageIFD.Artist] = ascii(s.businessName)

  const exif: Record<number, unknown> = {
    [piexif.ExifIFD.ExifVersion]: '0232',
    [piexif.ExifIFD.DateTimeOriginal]: dt,
    [piexif.ExifIFD.DateTimeDigitized]: dt,
    36880: off,
    36881: off,
    36882: off,
    [piexif.ExifIFD.PixelXDimension]: width,
    [piexif.ExifIFD.PixelYDimension]: height,
    [piexif.ExifIFD.ImageUniqueID]: id.replace(/-/g, '').slice(0, 32),
    // UserComment: 8-byte charset header + text.
    [piexif.ExifIFD.UserComment]: 'ASCII\0\0\0' + ascii(desc),
  }

  const gps: Record<number, unknown> = {}
  if (d.fix) {
    const f = d.fix
    const utc = new Date(f.timestamp)
    gps[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0]
    gps[piexif.GPSIFD.GPSLatitudeRef] = f.lat >= 0 ? 'N' : 'S'
    gps[piexif.GPSIFD.GPSLatitude] = dms(f.lat)
    gps[piexif.GPSIFD.GPSLongitudeRef] = f.lon >= 0 ? 'E' : 'W'
    gps[piexif.GPSIFD.GPSLongitude] = dms(f.lon)
    if (f.altitude != null) {
      gps[piexif.GPSIFD.GPSAltitudeRef] = f.altitude >= 0 ? 0 : 1
      gps[piexif.GPSIFD.GPSAltitude] = rational(f.altitude)
    }
    gps[piexif.GPSIFD.GPSHPositioningError] = rational(f.accuracy)
    if (f.speed != null) {
      gps[piexif.GPSIFD.GPSSpeedRef] = 'K'
      gps[piexif.GPSIFD.GPSSpeed] = rational(f.speed * 3.6)
    }
    if (d.heading != null) {
      gps[piexif.GPSIFD.GPSImgDirectionRef] = 'M'
      gps[piexif.GPSIFD.GPSImgDirection] = rational(d.heading)
    }
    gps[piexif.GPSIFD.GPSMapDatum] = 'WGS-84'
    gps[piexif.GPSIFD.GPSTimeStamp] = [
      [utc.getUTCHours(), 1],
      [utc.getUTCMinutes(), 1],
      [utc.getUTCSeconds(), 1],
    ]
    const p2 = (n: number) => String(n).padStart(2, '0')
    gps[piexif.GPSIFD.GPSDateStamp] = `${utc.getUTCFullYear()}:${p2(utc.getUTCMonth() + 1)}:${p2(utc.getUTCDate())}`
  }

  return piexif.dump({ '0th': zeroth, Exif: exif, GPS: gps })
}

/** Inserts EXIF into a JPEG data URL and returns a Blob. */
export function withExif(jpegDataUrl: string, exifBytes: string): Blob {
  const out = piexif.insert(exifBytes, jpegDataUrl)
  const bin = atob(out.split(',')[1])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}
