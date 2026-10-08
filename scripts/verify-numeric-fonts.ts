import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  app,
  appCss,
  duelPlay,
  duelResult,
  detailScreen,
  detailBoard,
  detailBoardCss,
  groupResult,
  groupResultDetail,
  coinFx,
  numericText,
  brandTitleUi,
  brandTitleNodesUi,
] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailScreen.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailBoard.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailBoard.css', 'utf8'),
  readFile('src/components/GroupResultScreen.tsx', 'utf8'),
  readFile('src/components/GroupResultDetailScreen.tsx', 'utf8'),
  readFile('src/components/CoinOpenFx.tsx', 'utf8'),
  readFile('src/ui/withDuelNums.tsx', 'utf8'),
  readFile('src/ui/BrandTitle.tsx', 'utf8'),
  readFile('src/ui/brandTitleNodes.tsx', 'utf8'),
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
assert.match(detailScreen, /className="duel-num">\{round\.capturedCoins\}/)
assert.match(detailBoard, /<span className="duel-num">\{marker\.openOrder\}<\/span>/)
assert.match(detailBoardCss, /\.duel-detail-open-marker\s*{[\s\S]*?font-family:\s*system-ui/)
assert.doesNotMatch(detailBoardCss, /\.duel-detail-open-marker\s*{[\s\S]*?font-family:\s*Georgia/)
assert.match(duelResult, /className="duel-num">\{value\}/)
assert.match(groupResult, /className="duel-num">\{entry\.totalCoins\}/)
assert.match(groupResultDetail, /className="duel-num">\{detail\.totalCoins\}/)
assert.match(groupResultDetail, /withDuelNums\(formatGroupRoundEndReason/)
/* Label Georgia must not out-specify `.duel-num` value digits. */
assert.match(appCss, /\.group-result-detail__summary\s*>\s*p\s*>\s*span\s*{/)
assert.match(appCss, /\.match-detail-round__stats\s*>\s*p\s*>\s*span\s*{/)
assert.doesNotMatch(appCss, /\.group-result-detail__summary\s+span\s*{/)
assert.doesNotMatch(appCss, /\.match-detail-round__stats\s+span\s*{/)

// COIN +1/+2/+3 labels use numeric glyphs without changing FX timing.
assert.equal((coinFx.match(/<span className="duel-num">\{label\}<\/span>/g) ?? []).length, 2)

// Brand title lead digit uses the shared lining numeral stack; rest stays Georgia.
assert.match(brandTitleNodesUi, /brand-title-digit duel-num/)
assert.match(brandTitleNodesUi, /brand-title-rest/)
assert.match(brandTitleUi, /brandTitleNodes/)
assert.match(app, /BrandTitle|brandTitleNodes/)
assert.match(duelResult, /BrandTitle/)
assert.match(detailScreen, /BrandTitle/)
assert.match(groupResult, /BrandTitle/)
assert.match(groupResultDetail, /BrandTitle/)
assert.match(appCss, /\.brand-title-digit\s*{/)
assert.match(appCss, /\.brand-title-rest\s*{/)
assert.doesNotMatch(appCss, /\.brand-title-digit\s*\{[^}]*transform:\s*translateY/)
assert.match(appCss, /\.app\s*{[\s\S]*?font-family:\s*Georgia,/)

console.log('verify:numeric-fonts OK')
