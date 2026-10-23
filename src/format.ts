const pad = (n: number, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0')

/** "GMT+05:00" for the device's current timezone (PKT on Pakistani phones). */
export function gmtOffset(d: Date) {
  const off = -d.getTimezoneOffset()
  return `GMT${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`
}

/** "+05:00" — EXIF OffsetTime format. */
export function exifOffset(d: Date) {
  return gmtOffset(d).slice(3)
}

export function stampDateTime(d: Date) {
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' })
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  const h = d.getHours() % 12 || 12
  const time = `${pad(h)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
  return `${day}, ${date} ${time} ${gmtOffset(d)}`
}

/** "2026:10:23 18:44:05" local time, as EXIF expects. */
export function exifDateTime(d: Date) {
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function fileStamp(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function shortDate(ts: number) {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
