/**
 * Browser-only helpers for “Add to Home Screen” CTA.
 * Does not touch capability URLs, SW, or install metadata.
 */

export type HomeInstallPlatform = 'ios' | 'android' | 'other'
export type HomeInstallGuideKind = 'ios' | 'android' | 'generic'

type BeforeInstallPromptLike = Event & {
  readonly prompt: () => Promise<void>
  readonly userChoice: Promise<{ readonly outcome: string }>
}

let deferredPrompt: BeforeInstallPromptLike | null = null
let appInstalledFlag = false
let listening = false
const subscribers = new Set<() => void>()

function notify(): void {
  for (const subscriber of subscribers) subscriber()
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    /* ignore */
  }
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

export function detectHomeInstallPlatform(): HomeInstallPlatform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  // iPadOS desktop-UA
  if (
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return 'ios'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

export function homeInstallGuideKind(
  platform: HomeInstallPlatform = detectHomeInstallPlatform(),
): HomeInstallGuideKind {
  if (platform === 'ios') return 'ios'
  if (platform === 'android') return 'android'
  return 'generic'
}

export function ensureHomeInstallListening(): void {
  if (typeof window === 'undefined' || listening) return
  listening = true

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptLike
    notify()
  })

  window.addEventListener('appinstalled', () => {
    appInstalledFlag = true
    deferredPrompt = null
    notify()
  })
}

export function subscribeHomeInstall(onChange: () => void): () => void {
  ensureHomeInstallListening()
  subscribers.add(onChange)
  return () => {
    subscribers.delete(onChange)
  }
}

export function getHomeInstallSnapshot(): {
  readonly standalone: boolean
  readonly installed: boolean
  readonly canPrompt: boolean
  readonly showCta: boolean
  readonly platform: HomeInstallPlatform
  readonly guideKind: HomeInstallGuideKind
} {
  const standalone = isStandaloneDisplay()
  const installed = appInstalledFlag
  const canPrompt = deferredPrompt != null
  return {
    standalone,
    installed,
    canPrompt,
    showCta: !standalone && !installed,
    platform: detectHomeInstallPlatform(),
    guideKind: homeInstallGuideKind(),
  }
}

/** Returns 'prompted' only when the native sheet was shown (not guide). */
export async function tryNativeHomeInstall(): Promise<'prompted' | 'unavailable'> {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  deferredPrompt = null
  try {
    await event.prompt()
    await event.userChoice
  } catch {
    /* user dismissed or browser rejected; stay safe */
  }
  notify()
  return 'prompted'
}
