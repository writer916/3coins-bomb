import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  app,
  appCss,
  duelPlay,
  duelResult,
  detailScreen,
  detailBoard,
  coinFx,
  numericText,
] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailScreen.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailBoard.tsx', 'utf8'),
  readFile('src/components/CoinOpenFx.tsx', 'utf8'),
  readFile('src/ui/withDuelNums.tsx', 'utf8'),
])

assert.match(numericText, /className="duel-num"/)
assert.match(appCss, /\.duel-num\s*{[\s\S]*?font-family:\s*system-ui,/)
assert.match(appCss, /\.score-num\s*{[\s\S]*?font-family:\s*system-ui,/)

// Shared 3COINS labels keep their words while only the leading digit is wrapped.
assert.match(app, /withDuelNums\('3COINS COMPLETE'\)/)
assert.match(duelPlay, /withDuelNums\('3COINS COMPLETE'\)/)
assert.match(duelResult, /<span>\{withDuelNums\(label\)\}<\/span>/)
assert.match(appCss, /\.duel-final-stat\s*>\s*span\s*{/)
assert.doesNotMatch(appCss, /\.duel-final-stat span\s*{/)

// ROUND progress/detail and OPEN-order markers use the same numeric stack.
assert.match(duelPlay, /withDuelNums\(t\.duelRoundProgress/)
assert.match(detailScreen, /withDuelNums\(label\)/)
assert.match(detailBoard, /<span className="duel-num">\{marker\.openOrder\}<\/span>/)

// COIN +1/+2/+3 labels use numeric glyphs without changing FX timing.
assert.equal((coinFx.match(/<span className="duel-num">\{label\}<\/span>/g) ?? []).length, 2)

// Brand title remains the deliberate Georgia exception.
assert.match(app, /className="brand-title-digit"/)
assert.doesNotMatch(app, /brand-title-digit duel-num|duel-num brand-title-digit/)
assert.match(appCss, /\.app\s*{[\s\S]*?font-family:\s*Georgia,/)

console.log('verify:numeric-fonts OK')
