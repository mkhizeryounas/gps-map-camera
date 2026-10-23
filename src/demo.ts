/*
 * Sample photo for the landing screen: a modern storefront at dusk for "JY & Sons".
 * Everything is drawn procedurally in proportions of the canvas, so it fits any screen.
 */

const SERIF = `"Cormorant Garamond", "Cormorant", Georgia, "Times New Roman", serif`
const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif`
const BRASS = '#d4af6a'

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string }

// Deterministic pseudo-random so the scene doesn't flicker between redraws.
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color.replace('ALPHA', String(alpha)))
  g.addColorStop(1, color.replace('ALPHA', '0'))
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

function fitFont(ctx: Ctx, text: string, weight: string, family: string, size: number, max: number) {
  ctx.font = `${weight} ${size}px ${family}`
  while (ctx.measureText(text).width > max && size > 4) {
    size *= 0.95
    ctx.font = `${weight} ${size}px ${family}`
  }
  return size
}

function sky(ctx: Ctx, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.5)
  g.addColorStop(0, '#120f2e')
  g.addColorStop(0.45, '#3b1d5e')
  g.addColorStop(0.8, '#a6456b')
  g.addColorStop(1, '#f39a5b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function facade(ctx: Ctx, W: number, H: number, top: number) {
  const g = ctx.createLinearGradient(0, top, 0, H)
  g.addColorStop(0, '#262b36')
  g.addColorStop(1, '#14171d')
  ctx.fillStyle = g
  ctx.fillRect(0, top, W, H - top)
  // roofline highlight catching the sunset
  ctx.fillStyle = 'rgba(255,170,120,0.25)'
  ctx.fillRect(0, top, W, H * 0.004)
  // vertical cladding seams
  ctx.fillStyle = 'rgba(255,255,255,0.025)'
  for (let x = W * 0.08; x < W; x += W * 0.16) ctx.fillRect(x, top, W * 0.003, H * 0.18)
}

function upperWindows(ctx: Ctx, W: number, H: number, y: number, h: number) {
  const n = 4
  const gap = W * 0.06
  const w = (W - gap * (n + 1)) / n
  const lit = [true, false, true, true]
  for (let i = 0; i < n; i++) {
    const x = gap + i * (w + gap)
    ctx.fillStyle = '#0c0f15'
    ctx.fillRect(x - W * 0.008, y - W * 0.008, w + W * 0.016, h + W * 0.016)
    if (lit[i]) {
      const g = ctx.createLinearGradient(0, y, 0, y + h)
      g.addColorStop(0, '#ffe3b3')
      g.addColorStop(1, '#e8924a')
      ctx.fillStyle = g
      ctx.fillRect(x, y, w, h)
      // blinds
      ctx.fillStyle = 'rgba(120,60,20,0.18)'
      for (let k = y + h * 0.08; k < y + h * 0.55; k += h * 0.07) ctx.fillRect(x, k, w, h * 0.025)
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h)
      g.addColorStop(0, '#2a2f4a')
      g.addColorStop(1, '#151927')
      ctx.fillStyle = g
      ctx.fillRect(x, y, w, h)
    }
    ctx.fillStyle = '#0c0f15'
    ctx.fillRect(x + w / 2 - W * 0.003, y, W * 0.006, h)
  }
}

function sign(ctx: Ctx, W: number, H: number, x: number, y: number, w: number, h: number) {
  ctx.save()
  // fascia
  ctx.fillStyle = '#07080b'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = BRASS
  ctx.fillRect(x, y, w, h * 0.03)
  ctx.fillRect(x, y + h * 0.97, w, h * 0.03)

  // monogram: fine brass ring with a serif "JY"
  const r = h * 0.3
  const mx = x + w * 0.05 + r
  const my = y + h / 2
  ctx.strokeStyle = BRASS
  ctx.lineWidth = Math.max(1, h * 0.018)
  ctx.beginPath()
  ctx.arc(mx, my, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(mx, my, r * 0.86, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = BRASS
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `italic 600 ${r * 1.0}px ${SERIF}`
  ctx.fillText('JY', mx - r * 0.03, my + r * 0.04)

  // wordmark: tracked uppercase serif with an italic ampersand, warmly backlit
  const left = mx + r + w * 0.04
  const right = x + w * 0.96
  const cx = (left + right) / 2
  const parts = [
    { text: 'JY', font: (z: number) => `600 ${z}px ${SERIF}`, track: 0.12, color: 'word' },
    { text: '&', font: (z: number) => `italic 500 ${z * 1.12}px ${SERIF}`, track: 0, color: 'brass' },
    { text: 'SONS', font: (z: number) => `600 ${z}px ${SERIF}`, track: 0.12, color: 'word' },
  ] as const
  const measure = (z: number) =>
    parts.map((p) => {
      ctx.font = p.font(z)
      ctx.letterSpacing = `${z * p.track}px`
      // letterSpacing also pads the last glyph; trim it so the parts sit evenly.
      return ctx.measureText(p.text).width - z * p.track
    })
  let size = h * 0.5
  let widths = measure(size)
  const total = (z: number, ws: number[]) => ws.reduce((a, b) => a + b, 0) + z * 0.32 * (parts.length - 1)
  while (total(size, widths) > right - left && size > 4) {
    size *= 0.95
    widths = measure(size)
  }
  const wordFill = ctx.createLinearGradient(0, my - size / 2, 0, my + size / 2)
  wordFill.addColorStop(0, '#fffaf0')
  wordFill.addColorStop(1, '#f6dcae')
  let px = cx - total(size, widths) / 2
  const baseY = my - h * 0.07
  ctx.textAlign = 'left'
  parts.forEach((p, i) => {
    ctx.font = p.font(size)
    ctx.letterSpacing = `${size * p.track}px`
    ctx.shadowColor = 'rgba(255,196,120,0.7)'
    ctx.shadowBlur = size * 0.35
    ctx.fillStyle = p.color === 'brass' ? '#e3bf78' : wordFill
    ctx.fillText(p.text, px, baseY + (p.color === 'brass' ? size * 0.02 : 0))
    px += widths[i] + size * 0.32
  })
  ctx.shadowBlur = 0
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'center'

  ctx.fillStyle = 'rgba(212,175,106,0.95)'
  const tag = 'FINE GOODS  ·  EST. 1998'
  let t = h * 0.1
  do {
    ctx.font = `600 ${t}px ${SANS}`
    ctx.letterSpacing = `${t * 0.35}px`
    t *= 0.94
  } while (ctx.measureText(tag).width > right - left && t > 4)
  ctx.fillText(tag, cx, my + h * 0.28)
  ctx.letterSpacing = '0px'
  ctx.restore()

  // downlights under the fascia
  for (const fx of [0.2, 0.5, 0.8]) {
    const lx = x + w * fx
    const ly = y + h
    ctx.fillStyle = '#fff6e0'
    ctx.fillRect(lx - W * 0.012, ly, W * 0.024, H * 0.004)
  }
}

function shopfront(ctx: Ctx, W: number, H: number, x: number, y: number, w: number, h: number) {
  const rand = rng(7)
  // warm interior
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#5a3218')
  g.addColorStop(0.35, '#e9a463')
  g.addColorStop(1, '#6b3a1c')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  glow(ctx, x + w / 2, y + h * 0.3, w * 0.6, 'rgba(255,235,200,ALPHA)', 0.55)

  // back-wall shelves with goods
  const shelfColor = '#3a2212'
  const goods = ['#c8553d', '#2d6a4f', '#e9c46a', '#264653', '#f4f1de', '#9c6644', '#6d597a', '#e07a5f']
  for (const [sx, sw] of [
    [x + w * 0.03, w * 0.3],
    [x + w * 0.67, w * 0.3],
  ] as const) {
    for (let k = 0; k < 4; k++) {
      const sy = y + h * (0.3 + k * 0.17)
      let px = sx + sw * 0.04
      while (px < sx + sw * 0.94) {
        const bw = sw * (0.07 + rand() * 0.08)
        const bh = h * (0.05 + rand() * 0.07)
        ctx.fillStyle = goods[Math.floor(rand() * goods.length)]
        ctx.fillRect(px, sy - bh, Math.min(bw, sx + sw * 0.96 - px), bh)
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(px, sy - bh, Math.min(bw, sx + sw * 0.96 - px) * 0.18, bh)
        px += bw + sw * 0.015
      }
      ctx.fillStyle = shelfColor
      ctx.fillRect(sx, sy, sw, h * 0.012)
    }
  }

  // counter in the middle back
  ctx.fillStyle = '#4a2a16'
  ctx.fillRect(x + w * 0.36, y + h * 0.62, w * 0.28, h * 0.2)
  ctx.fillStyle = 'rgba(255,220,170,0.35)'
  ctx.fillRect(x + w * 0.36, y + h * 0.62, w * 0.28, h * 0.012)

  // pendant lamps
  for (const fx of [0.22, 0.5, 0.78]) {
    const lx = x + w * fx
    const ly = y + h * 0.16
    ctx.strokeStyle = 'rgba(30,18,10,0.8)'
    ctx.lineWidth = Math.max(1, W * 0.002)
    ctx.beginPath()
    ctx.moveTo(lx, y)
    ctx.lineTo(lx, ly)
    ctx.stroke()
    glow(ctx, lx, ly + h * 0.02, w * 0.12, 'rgba(255,240,200,ALPHA)', 0.9)
    ctx.fillStyle = '#1d140d'
    ctx.beginPath()
    ctx.arc(lx, ly + h * 0.015, w * 0.03, Math.PI, 0)
    ctx.fill()
    ctx.fillStyle = '#fff3d6'
    ctx.beginPath()
    ctx.ellipse(lx, ly + h * 0.016, w * 0.022, h * 0.006, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // glass reflections
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.globalCompositeOperation = 'screen'
  for (const [ox, ow, a] of [
    [0.08, 0.1, 0.1],
    [0.22, 0.04, 0.07],
    [0.62, 0.08, 0.08],
  ] as const) {
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.beginPath()
    ctx.moveTo(x + w * ox, y + h)
    ctx.lineTo(x + w * (ox + ow), y + h)
    ctx.lineTo(x + w * (ox + ow + 0.25), y)
    ctx.lineTo(x + w * (ox + 0.25), y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()

  // frames + door
  const frame = '#0a0c10'
  const t = W * 0.014
  ctx.fillStyle = frame
  ctx.fillRect(x, y, w, t)
  ctx.fillRect(x, y + h - t, w, t)
  for (const fx of [0, 0.36, 0.64, 1]) ctx.fillRect(x + w * fx - t / 2, y, t, h)
  ctx.fillRect(x + w * 0.36, y + h * 0.12, w * 0.28, t * 0.8) // door transom
  // brass pull handles
  ctx.fillStyle = BRASS
  ctx.fillRect(x + w * 0.47, y + h * 0.42, t * 0.7, h * 0.22)
  ctx.fillRect(x + w * 0.53 - t * 0.7, y + h * 0.42, t * 0.7, h * 0.22)
}

export function paintStorefront(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const c = ctx as Ctx
  c.save()
  sky(c, W, H)
  const top = H * 0.1
  facade(c, W, H, top)
  upperWindows(c, W, H, H * 0.14, H * 0.1)

  const signY = H * 0.28
  const signH = H * 0.1
  sign(c, W, H, W * 0.04, signY, W * 0.92, signH)

  const shopY = signY + signH + H * 0.012
  const shopBottom = H * 0.86
  shopfront(c, W, H, W * 0.04, shopY, W * 0.92, shopBottom - shopY)

  // pavement + warm light spill
  const p = c.createLinearGradient(0, shopBottom, 0, H)
  p.addColorStop(0, '#2a2522')
  p.addColorStop(1, '#0e0f12')
  c.fillStyle = p
  c.fillRect(0, shopBottom, W, H - shopBottom)
  c.fillStyle = '#3a3330'
  c.fillRect(0, shopBottom, W, H * 0.006)
  glow(c, W / 2, shopBottom + H * 0.02, W * 0.55, 'rgba(255,190,120,ALPHA)', 0.35)

  // soft vignette for depth
  const v = c.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.45)')
  c.fillStyle = v
  c.fillRect(0, 0, W, H)
  c.restore()
}
