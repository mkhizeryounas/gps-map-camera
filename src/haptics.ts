export type Haptic = 'light' | 'medium' | 'heavy' | 'success' | 'warning'

const VIBRATE: Record<Haptic, number | number[]> = {
  light: 8,
  medium: 15,
  heavy: 25,
  success: [12, 60, 12],
  warning: [25, 80, 25],
}

// iOS Safari has no Vibration API, but toggling a native <input switch> (iOS 18+)
// plays the system haptic tick. Only works inside a user gesture.
let iosSwitch: HTMLLabelElement | null = null
function iosTick() {
  if (!iosSwitch) {
    iosSwitch = document.createElement('label')
    iosSwitch.setAttribute('aria-hidden', 'true')
    iosSwitch.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    iosSwitch.append(input)
    document.body.append(iosSwitch)
  }
  iosSwitch.click()
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
