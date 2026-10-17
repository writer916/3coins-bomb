/** DAILY completion navigation contracts (no DB/network/browser). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const play = readFileSync(resolve(root, 'src/components/DailyPlayScreen.tsx'), 'utf8')
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
const result = readFileSync(resolve(root, 'src/components/DailyResultScreen.tsx'), 'utf8')
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')

// Completion never invokes RESULT from an effect or timer.
assert.doesNotMatch(play, /challengeCompleteNotifiedRef/)
assert.doesNotMatch(play, /useEffect\([\s\S]{0,500}onShowResult/)
assert.doesNotMatch(play, /setTimeout\([\s\S]{0,300}onShowResult/)

// RESULT and TOP are explicit, ordered, and independently wired.
const actionsAt = play.indexOf('daily-play__complete-actions')
assert.ok(actionsAt >= 0)
const resultAt = play.indexOf('onClick={showResult}', actionsAt)
const topAt = play.indexOf('onClick={onGoTop}', actionsAt)
assert.ok(resultAt > actionsAt)
assert.ok(topAt > resultAt)
assert.match(play, /\{t\.dailyViewResult\}/)
assert.doesNotMatch(play, /\{t\.groupResultTitle\}/)
assert.match(play, /className="duel-btn duel-btn--primary"/)
assert.match(play, /className="duel-btn duel-btn--quiet-top"/)
assert.match(play, /resultReady && fx === null && !requestPending/)
assert.match(play, /if \([\s\S]*?!resultReady[\s\S]*?lockRef\.current[\s\S]*?\) \{\s*return/)
assert.match(app, /onShowResult=\{\(\{ challengeDate \}\) => \{\s*setDailyPhase\(\{ kind: 'result', challengeDate \}\)/)
assert.match(app, /const goTop = useCallback\([\s\S]*?setScreen\('top'\)[\s\S]*?setDailyPhase\(\{ kind: 'prestart' \}\)/)

// DAILY RESULT keeps retrieval/detail/automatic ranking recovery, BACK TO TOP,
// and explicit TRY AGAIN on load failures (aligned with verify-daily-result-ui).
assert.match(result, /groupResultRetry/)
assert.match(result, /data-daily-result-retry/)
assert.match(result, /handleRetry/)
assert.doesNotMatch(result, /data-daily-ranking-retry|onRetryRanking/)
assert.match(result, /fetchDailySelfResult/)
assert.match(result, /fetchDailyRanking/)
assert.match(result, /msUntilNextDailyRankingRefresh/)
assert.match(result, /visibilitychange/)
assert.match(result, /DailyResultDetailScreen/)
assert.match(result, /onClick=\{onGoTop\}/)
// ranking_loading must stay a wait UI (no unfinished RESULT table flash).
assert.match(result, /phase\.kind === 'loading_self' \|\| phase\.kind === 'ranking_loading'/)

// Existing re-entry of a completed participant still opens RESULT.
assert.match(app, /if \(state\.completedAt\) \{[\s\S]*?kind: 'result'/)
assert.match(app, /DailyPriorFinalScreen/)

// Completion replaces the play board after FX, and the two vertical buttons
// remain reachable inside DAILY's fixed viewport shell.
assert.match(css, /\.daily-play__complete-actions \{[\s\S]*?flex-direction: column/)
assert.match(css, /\.app--daily-play \{[\s\S]*?height: 100dvh;[\s\S]*?scrollbar-gutter: stable/)
assert.match(css, /\.daily-play--complete \{[\s\S]*?safe-area-inset-bottom/)
assert.match(css, /\.daily-play__end-slot \{[\s\S]*?min-height:/)

console.log('daily completion navigation verification: PASS')
