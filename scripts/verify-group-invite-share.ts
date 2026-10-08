/** GROUP invite share wizard / READY manual start / layout wiring checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  copyGroupInviteUrl,
  formatGroupShareUrlForDisplay,
  renderGroupHostQrSvg,
  renderGroupInviteQrSvg,
} from '../src/group/groupInviteActions.ts'
import {
  createGroupHostUrl,
  createGroupInvitationUrl,
  classifyGroupUrlFragment,
} from '../src/group/groupInvitation.ts'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const root = resolve(import.meta.dirname, '..')
const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const INVITE = `3cb_gi1_${'a'.repeat(42)}A`
const HOST = `3cb_gh1_${'b'.repeat(42)}A`
const url = createGroupInvitationUrl('https://example.test', GROUP_ID, INVITE)
const hostUrl = createGroupHostUrl('https://example.test', GROUP_ID, HOST, INVITE)

assert.equal(formatGroupShareUrlForDisplay(url), 'example.test/group/…')
assert.equal(formatGroupShareUrlForDisplay(hostUrl), 'example.test/group/…')
assert(!formatGroupShareUrlForDisplay(url).includes(INVITE))
assert(!formatGroupShareUrlForDisplay(url).includes(HOST))
assert(!formatGroupShareUrlForDisplay(hostUrl).includes(INVITE))
assert(!formatGroupShareUrlForDisplay(hostUrl).includes(HOST))
assert.match(url, /#invite=/)
assert.match(hostUrl, /#host=/)
assert.match(hostUrl, /invite=/)
assert(!url.includes(HOST))
assert(!url.includes('3cb_gh1_'))
assert(!url.includes('3cb_gp1_'))
assert.notEqual(url, hostUrl)
assert.equal(classifyGroupUrlFragment(url), 'invite')
assert.equal(classifyGroupUrlFragment(hostUrl), 'host')

const svg = renderGroupInviteQrSvg(url)
assert.match(svg, /<svg[\s\S]*<\/svg>/i)
assert(!svg.includes(HOST))

const hostSvg = renderGroupHostQrSvg(hostUrl)
assert.match(hostSvg, /<svg[\s\S]*<\/svg>/i)
assert.notEqual(hostSvg, svg)

const writes: string[] = []
const copied = await copyGroupInviteUrl(url, {
  writeText: async (value) => {
    writes.push(value)
  },
})
assert.equal(copied, 'copied')
assert.deepEqual(writes, [url])

const hostWrites: string[] = []
const hostCopied = await copyGroupInviteUrl(hostUrl, {
  writeText: async (value) => {
    hostWrites.push(value)
  },
})
assert.equal(hostCopied, 'copied')
assert.deepEqual(hostWrites, [hostUrl])

assert.equal(ja.groupInvitePlayersLabel, '参加者用URL')
assert.match(ja.groupInvitePlayersIntro, /今回のゲーム専用URLです/)
assert.match(ja.groupInvitePlayersIntro, /URLとニックネームは重要です/)
assert.equal(ja.groupInviteHostLabel, 'あなた用URL')
assert.match(ja.groupInviteHostIntro, /勝負が終わるまでこのURLを保管してください/)
assert.match(ja.groupInviteHostIntro, /別の端末からでもこの対戦に戻れます/)
assert.equal(ja.groupInviteHostKeepPrivate, 'このURLは参加者には送らないでください。')
assert.equal(ja.groupNicknameLead, 'この対戦でのニックネーム')
assert.equal(ja.groupPlayReady, 'PLAY準備完了')
assert.equal(ja.groupPlayPreparing, '準備しています…')
assert.equal(ja.groupPlayStart, 'ゲームをはじめる')
assert.equal(ja.groupCreateError, '作成できませんでした。もう一度お試しください。')
assert.equal(ja.groupRoundsLabel, 'ROUNDS（1-20）')
assert.equal(ja.groupPlayersLabel, 'PLAYERS（2-20）')
assert.equal(ja.groupReadyRoundsLabel, 'ROUNDS')
assert.equal(ja.groupReadyPlayersLabel, '参加人数')
assert.equal(ja.groupReadyNicknameLabel, 'あなたのニックネーム')
assert.equal(en.groupInvitePlayersLabel, 'PLAYER URL')
assert.match(en.groupInvitePlayersIntro, /This URL is for this game only/)
assert.equal(en.groupNicknameLead, 'Nickname for this match')
assert.equal(en.groupCreateError, 'Could not create. Please try again.')
assert.equal(en.groupRoundsLabel, 'ROUNDS（1-20）')
assert.equal(en.groupPlayersLabel, 'PLAYERS（2-20）')
assert.equal(en.groupReadyRoundsLabel, 'ROUNDS')
assert.equal(en.groupReadyPlayersLabel, 'PLAYERS')
assert.equal(en.groupReadyNicknameLabel, 'YOUR NICKNAME')
assert.doesNotMatch(ja.groupInvitePlayersIntro, /\n/)
assert.doesNotMatch(ja.groupInviteHostIntro, /\n/)
assert.doesNotMatch(ja.groupNicknameLead, /あなた用URLを保存/)
assert.doesNotMatch(ja.groupRoundsLabel, /〜|～|–/)
assert.doesNotMatch(ja.groupPlayersLabel, /〜|～|–/)
assert.doesNotMatch(ja.groupCreateError, /GROUPを作成できませんでした/)

const entry = readFileSync(resolve(root, 'src/components/GroupEntryShell.tsx'), 'utf8')
assert.match(entry, /GroupInviteShareScreen/)
assert.match(entry, /GroupReadyScreen/)
assert.match(entry, /startedPlay/)
assert.match(entry, /setStartedPlay\(true\)/)
assert.match(entry, /groupNicknameLead/)
assert.match(entry, /readyTotalRounds/)
assert.match(entry, /readyPlayerLimit/)
assert.match(entry, /result\.totalRounds/)
assert.match(entry, /result\.playerLimit/)
assert.match(entry, /hostUrlFromGroupHost/)
assert.match(entry, /classifyGroupUrlFragment/)
assert.match(entry, /duel-button-field/)
assert.match(entry, /groupJoin/)
assert.doesNotMatch(entry, /groupNicknameResumeHint/)
assert.doesNotMatch(entry, /groupNicknameHostResumeHint/)
assert.doesNotMatch(entry, /GROUP_READY_MIN_MS/)
assert.doesNotMatch(entry, /setTimeout/)
assert.doesNotMatch(entry, /#p=/)
assert.doesNotMatch(entry, /host_token_hash/)

const share = readFileSync(
  resolve(root, 'src/components/GroupInviteShareScreen.tsx'),
  'utf8',
)
assert.match(share, /groupInvitePlayersLabel/)
assert.match(share, /groupInviteHostLabel/)
assert.match(share, /groupInvitePlayersIntro/)
assert.match(share, /groupInviteHostIntro/)
assert.match(share, /groupInviteHostKeepPrivate/)
assert.match(share, /group-invite-copy-block/)
assert.match(share, /SharePage = 'players' \| 'host'/)
assert.match(share, /groupInviteEnterNickname/)
assert.match(share, /copyGroupInviteUrl/)
assert.match(share, /renderGroupInviteQrSvg/)
assert.match(share, /renderGroupHostQrSvg/)
assert.match(share, /hostUrl/)
assert.match(share, /invitationUrl/)
assert.doesNotMatch(share, /hostToken\s*=/)
assert.doesNotMatch(share, /duelSelfUrlLabel/)

const ready = readFileSync(resolve(root, 'src/components/GroupReadyScreen.tsx'), 'utf8')
assert.match(ready, /duel-flow--start-confirm/)
assert.match(ready, /duel-start-confirm__list/)
assert.match(ready, /groupReadyRoundsLabel/)
assert.match(ready, /groupReadyPlayersLabel/)
assert.match(ready, /groupReadyNicknameLabel/)
assert.match(ready, /groupPlayStart/)
assert.match(ready, /groupPlayPreparing/)
assert.match(ready, /groupPlayReady/)
assert.match(ready, /canStart/)
assert.match(ready, /onStart/)
assert.match(ready, /totalRounds/)
assert.match(ready, /playerLimit/)
assert.doesNotMatch(ready, /setTimeout/)
assert.match(ready, /canStart \? \(/)
assert.doesNotMatch(ready, /canStart \? t\.groupPlayStart : t\.groupPlayPreparing/)

const waiting = readFileSync(
  resolve(root, 'src/components/GroupCompletionWaiting.tsx'),
  'utf8',
)
assert.match(waiting, /duel-button-field/)
assert.match(waiting, /duel-btn-stack/)
assert.match(waiting, /POLL_MS = 5000/)

const jaSource = readFileSync(resolve(root, 'src/i18n/ja.ts'), 'utf8')
assert.match(jaSource, /参加者用URL/)
assert.match(jaSource, /あなた用URL/)
assert.match(jaSource, /この対戦でのニックネーム/)
assert.match(jaSource, /このURLは参加者には送らないでください/)
assert.match(jaSource, /ゲームをはじめる/)
assert.doesNotMatch(jaSource, /HOST操作はこの端末にだけ残ります/)
assert.doesNotMatch(jaSource, /groupNicknameResumeHint/)
assert.doesNotMatch(jaSource, /groupNicknameHostResumeHint/)

const actions = readFileSync(resolve(root, 'src/group/groupInviteActions.ts'), 'utf8')
assert.match(actions, /parseGroupInvitationUrl/)
assert.match(actions, /parseGroupHostUrl/)
assert.match(actions, /formatGroupShareUrlForDisplay/)
assert.match(actions, /renderGroupHostQrSvg/)

const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')
assert.match(css, /group-invite-copy-block/)
assert.match(css, /group-invite-share \.group-invite-copy-block/)
assert.match(css, /min-height: calc\(\(0\.86rem \* 1\.55 \* 4\) \+ 0\.45rem \+ \(0\.86rem \* 1\.55\)\)/)
assert.match(css, /group-entry-ready \.duel-start-confirm__ready/)
assert.match(css, /\.duel-flow--setup \.duel-btn-stack/)
assert.match(css, /duel-lock-error--slot/)

const createFlow = readFileSync(
  resolve(root, 'src/components/GroupCreateFlow.tsx'),
  'utf8',
)
assert.match(createFlow, /duel-lock-error--slot/)
assert.match(createFlow, /error=\{failed \? t\.groupCreateError : null\}/)
assert.match(createFlow, /group-create-flow/)
assert.doesNotMatch(createFlow, /failed \? t\.groupCreateError : '\\u00a0'/)
assert.match(css, /group-create-flow \.duel-btn-area/)
assert.match(
  css,
  /\.duel-lock-error--slot\s*\{[\s\S]*?position:\s*absolute/,
)

console.log('verify:group-invite-share OK')
