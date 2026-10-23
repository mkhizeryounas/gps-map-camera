export type Haptic = 'light' | 'medium' | 'heavy' | 'success' | 'warning'

const VIBRATE: Record<Haptic, number | number[]> = {
  light: 8,
  medium: 15,
  heavy: 25,
  success: [12, 60, 12],
  warning: [25, 80, 25],
}

// iOS Safari has no Vibration API, but toggling a native <input type=checkbox switch>
// (Safari 18+) plays the system haptic tick. A fresh, hidden switch is clicked each time,
// and it only fires inside a user gesture.
function iosTick() {
  // Kept rendered (nearly transparent, not display:none): iOS only plays the tick for a live control.
  const label = document.createElement('label')
  label.ariaHidden = 'true'
  label.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;overflow:hidden'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.tabIndex = -1
  label.append(input)
  document.body.append(label)
  label.click()
  setTimeout(() => label.remove(), 300)
}

export function haptic(kind: Haptic = 'light') {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(VIBRATE[kind])
    return
  }
  iosTick()
  if (kind === 'success' || kind === 'warning') setTimeout(iosTick, 90)
}

/** Light tap on every button press; override per button with data-haptic="medium|heavy|warning|none". */
export function installButtonHaptics() {
  document.addEventListener(
    'click',
    (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button, .seg label, .switch')
      if (!b || (b as HTMLButtonElement).disabled) return
      const kind = b.dataset.haptic
      if (kind === 'none') return
      haptic((kind as Haptic) || 'light')
    },
    true,
  )
}
