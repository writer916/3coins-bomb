import { useCallback, useEffect, useState } from 'react'
import {
  getHomeInstallSnapshot,
  homeInstallGuideKind,
  subscribeHomeInstall,
  tryNativeHomeInstall,
  type HomeInstallGuideKind,
} from './homeInstall'

export function useHomeInstallCta(): {
  readonly showCta: boolean
  readonly guideOpen: boolean
  readonly guideKind: HomeInstallGuideKind
  readonly onAddClick: () => void
  readonly closeGuide: () => void
} {
  const [tick, setTick] = useState(0)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeHomeInstall(() => setTick((n) => n + 1))
    return () => {
      unsubscribe()
    }
  }, [])

  // tick forces re-read after beforeinstallprompt / appinstalled
  void tick
  const snapshot = getHomeInstallSnapshot()

  const onAddClick = useCallback(() => {
    void (async () => {
      const result = await tryNativeHomeInstall()
      if (result === 'prompted') {
        setGuideOpen(false)
        return
      }
      setGuideOpen(true)
    })()
  }, [])

  const closeGuide = useCallback(() => {
    setGuideOpen(false)
  }, [])

  return {
    showCta: snapshot.showCta,
    guideOpen,
    guideKind: guideOpen ? homeInstallGuideKind(snapshot.platform) : snapshot.guideKind,
    onAddClick,
    closeGuide,
  }
}
