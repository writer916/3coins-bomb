/** GROUP progress, automatic finalize, host close, privacy, and waiting UI. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGroupProgressHandler } from '../api/_group/matches/[groupId]/progress.ts'
import { createGroupCloseHandler } from '../api/_group/matches/[groupId]/close.ts'
import { GroupProgressError } from '../server/group/progress.ts'
import { parseGroupProgress } from '../src/group/groupPlayClient.ts'

const root = resolve(import.meta.dirname, '..')
const groupId = '123e4567-e89b-42d3-a456-426614174000'
const requestId = '423e4567-e89b-42d3-a456-426614174000'

/** Host-first: bound host participant. */
const hostView = {
  groupId,
  playerLimit: 4,
  acceptedCount: 3,
  completedCount: 2,
  status: 'open' as const,
  selfCompleted: true,
  selfIsHostParticipant: true,
  hostCloseAvailable: true,
}
assert.deepEqual(parseGroupProgress(hostView, groupId), hostView)

/** Guest-first / host_participant_id IS NULL: must be boolean false, not null. */
const guestBeforeHost = {
  groupId,
  playerLimit: 2,
  acceptedCount: 1,
  completedCount: 0,
  status: 'open' as const,
  selfCompleted: false,
  selfIsHostParticipant: false,
  hostCloseAvailable: false,
}
assert.deepEqual(parseGroupProgress(guestBeforeHost, groupId), guestBeforeHost)
assert.throws(
  () => parseGroupProgress({ ...guestBeforeHost, selfIsHostParticipant: null }, groupId),
)
assert.throws(
  () => parseGroupProgress({ ...guestBeforeHost, selfIsHostParticipant: undefined }, groupId),
)

/** Existing participant rejoin (non-host): boolean false remains valid. */
const rejoinedGuest = {
  ...guestBeforeHost,
  acceptedCount: 2,
  selfIsHostParticipant: false,
  hostCloseAvailable: false,
}
assert.deepEqual(parseGroupProgress(rejoinedGuest, groupId), rejoinedGuest)

assert.throws(() => parseGroupProgress({ ...hostView, participants: [{ nickname: 'secret' }] }, groupId))
assert.throws(() => parseGroupProgress({ ...hostView, completedCount: 4 }, groupId))

const progress = await createGroupProgressHandler(async () => guestBeforeHost)(
  new Request(`https://example.test/api/group/matches/${groupId}/progress`, {
    headers: { Authorization: 'Bearer hidden' },
  }),
)
assert.equal(progress.status, 200)
assert.equal(progress.headers.get('cache-control'), 'no-store')
const progressBody = await progress.json()
assert.deepEqual(progressBody, guestBeforeHost)
assert.equal(typeof (progressBody as { selfIsHostParticipant: unknown }).selfIsHostParticipant, 'boolean')
const text = JSON.stringify(progressBody)
for (const secret of ['nickname', 'participantId', 'score', 'roundNumber']) {
  assert.equal(text.includes(secret), false)
}

const closed = { ...hostView, status: 'closed' as const, hostCloseAvailable: false }
const close = await createGroupCloseHandler(async () => closed)(
  new Request(`https://example.test/api/group/matches/${groupId}/close`, {
    method: 'POST',
    headers: { Authorization: 'Bearer host', 'Idempotency-Key': requestId },
  }),
)
assert.equal(close.status, 200)
assert.deepEqual(await close.json(), closed)

const denied = await createGroupCloseHandler(async () => {
  throw new GroupProgressError('CONFLICT')
})(new Request(`https://example.test/api/group/matches/${groupId}/close`, { method: 'POST' }))
assert.equal(denied.status, 409)

const db = readFileSync(resolve(root, 'server/db/groupProgress.ts'), 'utf8')
for (const part of [
  'coalesce(match.host_participant_id=self.id,false)',
  'self_is_host===true',
  'count(other.id) filter',
  'host.completed_at',
  'for update of match',
  "status='closed'",
  'participant.completed_at is null',
  'excluded_at=statement_timestamp()',
]) {
  assert.ok(db.includes(part), part)
}
assert.equal(db.includes('(match.host_participant_id=self.id) self_is_host'), false)

for (const file of ['server/db/openGroupBag.ts', 'server/db/cashOutGroupRound.ts']) {
  const source = readFileSync(resolve(root, file), 'utf8')
  for (const part of [
    'auto_closed',
    'match.accepted_count=match.player_limit',
    'completed_participant',
    "set status='closed'",
  ]) {
    assert.ok(source.includes(part), `${file}: ${part}`)
  }
}

const resume = readFileSync(resolve(root, 'server/db/groupPlay.ts'), 'utf8')
for (const part of [
  "status = 'interrupted'",
  'completed_participant',
  'auto_closed',
  'for update of match, participant',
]) {
  assert.ok(resume.includes(part), part)
}

const waiting = readFileSync(resolve(root, 'src/components/GroupCompletionWaiting.tsx'), 'utf8')
for (const part of [
  'POLL_MS = 5000',
  'visibilityState',
  'visibilitychange',
  'groupPlayComplete',
  'groupParticipantsProgress',
  'groupCompletedProgress',
  'groupCloseConfirm',
  'window.confirm',
  'hasHostCapability',
  'hostCloseAvailable',
  'group-completion-waiting__close',
  'duel-btn--quiet-top',
]) {
  assert.ok(waiting.includes(part), part)
}
assert.equal(waiting.includes('displayNickname'), false)
assert.equal(waiting.includes('participantId'), false)
assert.equal(waiting.includes('duel-btn--primary'), false)

const waitingCss = readFileSync(resolve(root, 'src/App.css'), 'utf8')
assert.match(waitingCss, /\.group-completion-waiting__close\s*\{/)
assert.match(waitingCss, /\.group-completion-waiting__aux\s*\{/)

console.log('verify:group-progress OK')
