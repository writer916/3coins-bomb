import { renderSVG } from 'uqr'
import {
  copyDuelInviteUrl,
  DuelInviteActionError,
  renderDuelInviteQrSvg,
  shareDuelInviteUrl,
  type DuelInviteCopyResult,
  type DuelInviteShareResult,
} from '../duel/duelInviteActions'
import {
  classifyGroupUrlFragment,
  parseGroupHostUrl,
  parseGroupInvitationUrl,
} from './groupInvitation'

/** Short display form; clipboard/share/QR keep the full URL. */
export function formatGroupShareUrlForDisplay(url: string): string {
  const kind = classifyGroupUrlFragment(url)
  if (kind !== 'invite' && kind !== 'host') return '…'
  try {
    const parsed = new URL(url)
    return `${parsed.host}/group/…`
  } catch {
    return '…'
  }
}

function assertShareableGroupUrl(url: string): void {
  const kind = classifyGroupUrlFragment(url)
  if (kind === 'invite') {
    parseGroupInvitationUrl(url)
    return
  }
  if (kind === 'host') {
    parseGroupHostUrl(url)
    return
  }
  throw new DuelInviteActionError()
}

export function copyGroupInviteUrl(
  url: string,
  clipboard?: Pick<Clipboard, 'writeText'>,
): Promise<DuelInviteCopyResult> {
  assertShareableGroupUrl(url)
  return copyDuelInviteUrl(url, clipboard)
}

export function shareGroupInviteUrl(
  url: string,
  title: string,
  shareApi?: Pick<Navigator, 'share'>,
): Promise<DuelInviteShareResult> {
  assertShareableGroupUrl(url)
  return shareDuelInviteUrl(url, title, shareApi)
}

/** Player invite QR — reuses DUEL `#invite=` helper. */
export function renderGroupInviteQrSvg(inviteUrl: string): string {
  parseGroupInvitationUrl(inviteUrl)
  try {
    return renderDuelInviteQrSvg(inviteUrl)
  } catch {
    throw new DuelInviteActionError()
  }
}

/** Host personal URL QR (fragment includes host + invite). */
export function renderGroupHostQrSvg(hostUrl: string): string {
  parseGroupHostUrl(hostUrl)
  try {
    const parsed = new URL(hostUrl)
    if (parsed.search) throw new Error('query')
    return renderSVG(hostUrl, { ecc: 'M', border: 2 })
  } catch {
    throw new DuelInviteActionError()
  }
}

export { DuelInviteActionError as GroupInviteActionError }
