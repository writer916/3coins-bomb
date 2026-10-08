/**
 * Headless Chrome rendering check for RESULT / play-detail numeric fonts.
 * Starts Chrome with remote debugging; measures JA/EN across viewports.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const debugPort = 9333
const viewports = [
  [320, 568],
  [375, 667],
  [390, 844],
  [768, 1024],
  [1280, 800],
]

const [appCss, boardCss] = await Promise.all([
  readFile(resolve(root, 'src/App.css'), 'utf8'),
  readFile(resolve(root, 'src/components/DuelMatchDetailBoard.css'), 'utf8'),
])

/* Keep in sync with src/i18n/{en,ja}.ts RESULT/detail labels used here. */
const copy = {
  en: {
    groupResultTitle: 'GROUP RESULT',
    groupViewDetails: 'VIEW DETAILS',
    duelReturnToTop: 'TOP',
    groupParticipantDetails: 'PLAY DETAILS',
    groupBackToResult: 'BACK TO RESULT',
    duelYou: 'YOU',
    duelBackToResult: 'BACK TO RESULT',
  },
  ja: {
    groupResultTitle: 'GROUP RESULT',
    groupViewDetails: '詳細',
    duelReturnToTop: 'TOP',
    groupParticipantDetails: 'プレイ詳細',
    groupBackToResult: '結果に戻る',
    duelYou: 'あなた',
    duelBackToResult: '結果に戻る',
  },
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
${appCss}
${boardCss}
body { margin: 0; background: #1a1410; color: #f2e6d0; font-family: Georgia, 'Times New Roman', serif; }
main { box-sizing: border-box; min-height: 100dvh; padding: 0.75rem; }
</style>
</head>
<body>
<main id="root"></main>
<script>
window.__COPY = ${JSON.stringify(copy)};
window.__paint = (locale) => {
  const t = window.__COPY[locale];
  document.documentElement.lang = locale;
  document.getElementById('root').innerHTML = \`
    <section class="group-result" data-pane="group-result">
      <h2 class="group-result__title">\${t.groupResultTitle}</h2>
      <div class="group-result__table">
        <ol class="group-result__ranking">
          <li class="group-result__cols group-result__entry">
            <span class="group-result__rank"><span class="duel-num">1</span></span>
            <span class="group-result__nickname">Alice</span>
            <strong class="group-result__metric"><span class="duel-num">6</span></strong>
            <strong class="group-result__metric"><span class="duel-num">2</span></strong>
            <strong class="group-result__metric"><span class="duel-num">46</span>.<span class="duel-num">2</span>%</strong>
            <button type="button" class="duel-btn duel-btn--quiet-top group-result__details">\${t.groupViewDetails}</button>
          </li>
          <li class="group-result__cols group-result__entry">
            <span class="group-result__rank"><span class="duel-num">12</span></span>
            <span class="group-result__nickname">Bob</span>
            <strong class="group-result__metric"><span class="duel-num">60</span></strong>
            <strong class="group-result__metric"><span class="duel-num">20</span></strong>
            <strong class="group-result__metric"><span class="duel-num">100</span>%</strong>
            <button type="button" class="duel-btn duel-btn--quiet-top group-result__details">\${t.groupViewDetails}</button>
          </li>
        </ol>
      </div>
      <button type="button" class="duel-btn group-result__top">\${t.duelReturnToTop}</button>
    </section>
    <section class="group-result-detail" data-pane="group-detail">
      <h2 class="group-result-detail__title">\${t.groupParticipantDetails}</h2>
      <p class="group-result-detail__nickname">Player</p>
      <div class="group-result-detail__summary">
        <p><span>TOTAL COINS</span><strong><span class="duel-num">6</span></strong></p>
        <p><span>3COINS COMPLETE</span><strong><span class="duel-num">2</span></strong></p>
        <p><span>HIT RATE</span><strong><span class="duel-num">46</span>.<span class="duel-num">2</span>%</strong></p>
      </div>
      <ol class="group-result-detail__rounds">
        <li class="group-result-detail__round">
          <div class="match-detail-round__head">
            <p class="match-detail-round__label">ROUND <span class="duel-num">1</span></p>
            <p class="match-detail-round__end">BOMB</p>
          </div>
          <div class="match-detail-round__stats">
            <p><span>COINS</span><strong><span class="duel-num">0</span></strong></p>
            <p><span>OPEN</span><strong><span class="duel-num">5</span></strong></p>
          </div>
          <div class="duel-match-detail-board">
            <div class="duel-detail-open-marker" style="position:relative;width:1.2rem;height:1.2rem;margin:0.4rem auto">
              <span class="duel-num">3</span>
            </div>
          </div>
        </li>
      </ol>
      <button type="button" class="duel-btn group-result-detail__back">\${t.groupBackToResult}</button>
    </section>
    <section class="duel-final duel-final--completed" data-pane="duel-result">
      <div class="duel-final-body">
        <div class="duel-final-scores">
          <div class="duel-final-player">
            <h3>\${t.duelYou}</h3>
            <div class="duel-final-stats">
              <p class="duel-final-stat"><span>TOTAL COINS</span><strong><span class="duel-num">9</span></strong></p>
              <p class="duel-final-stat"><span>3COINS COMPLETE</span><strong><span class="duel-num">2</span></strong></p>
              <p class="duel-final-stat"><span>BOMBS HIT</span><strong><span class="duel-num">1</span></strong></p>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section class="duel-match-detail" data-pane="duel-detail">
      <div class="match-detail-round__stats">
        <p><span>COINS</span><strong><span class="duel-num">0</span></strong></p>
        <p><span>OPEN</span><strong><span class="duel-num">12</span></strong></p>
      </div>
      <button type="button" class="duel-btn duel-match-detail__back">\${t.duelBackToResult}</button>
    </section>
  \`;
};
window.__paint('en');
</script>
</body>
</html>`

const staticServer = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }
  res.writeHead(404)
  res.end('missing')
})
await new Promise((resolveListen) => staticServer.listen(0, '127.0.0.1', resolveListen))
const pageUrl = `http://127.0.0.1:${staticServer.address().port}/`
const userDataDir = resolve(root, '.tmp-chrome-font-verify')
await rm(userDataDir, { recursive: true, force: true })

const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

async function waitForDebugger(timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (response.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('Chrome remote debugging did not become ready')
}

let failed = null
try {
  await waitForDebugger()
  const target = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`,
    { method: 'PUT' },
  ).then((response) => response.json())
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let commandId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  function send(method, params = {}) {
    commandId += 1
    const id = commandId
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolveSend, reject) =>
      pending.set(id, { resolve: resolveSend, reject }),
    )
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed')
    }
    return result.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await new Promise((r) => setTimeout(r, 600))
  await evaluate('window.__paint("en")')
  await new Promise((r) => setTimeout(r, 100))

  const cssProbe = await evaluate(`(() => {
    const sheet = [...document.styleSheets].flatMap((s) => {
      try { return [...s.cssRules].map((r) => r.cssText) } catch { return [] }
    })
    const duelNumRules = sheet.filter((text) => text.includes('.duel-num'))
    const sample = document.querySelector('.group-result__metric .duel-num')
    const bare = document.querySelector('.group-result-detail__summary .duel-num')
    return {
      duelNumRuleCount: duelNumRules.length,
      sampleFamily: sample ? getComputedStyle(sample).fontFamily : null,
      bareFamily: bare ? getComputedStyle(bare).fontFamily : null,
      bareParentFamily: bare?.parentElement
        ? getComputedStyle(bare.parentElement).fontFamily
        : null,
      firstDuelNumRule: duelNumRules[0] || null,
    }
  })()`)
  console.log('cssProbe', cssProbe)
  assert.ok(cssProbe.duelNumRuleCount > 0, '`.duel-num` CSS rule missing from stylesheet')
  assert.match(cssProbe.sampleFamily || '', /system-ui/i)

  let cases = 0
  for (const [width, height] of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    })
    for (const locale of ['en', 'ja']) {
      await evaluate(`window.__paint('${locale}')`)
      await new Promise((r) => setTimeout(r, 40))
      const measured = await evaluate(`(() => {
        const nums = [...document.querySelectorAll('.duel-num')]
        const details = nums.map((el) => ({
          text: el.textContent,
          family: getComputedStyle(el).fontFamily,
          parent: el.parentElement?.className || '',
        }))
        const families = [...new Set(details.map((d) => d.family))]
        const nonSystem = details.filter((d) => !/system-ui/i.test(d.family))
        const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
        const panes = ['group-result','group-detail','duel-result','duel-detail'].map((name) => {
          const el = document.querySelector('[data-pane="' + name + '"]')
          const rect = el.getBoundingClientRect()
          return { name, width: rect.width, overflow: el.scrollWidth > el.clientWidth + 0.5 }
        })
        return { families, nonSystem, overflowX, panes, count: nums.length }
      })()`)
      assert.equal(
        measured.nonSystem.length,
        0,
        `non-system duel-num @${width} ${locale}: ${JSON.stringify(measured.nonSystem)}`,
      )
      assert.ok(measured.families.every((family) => /system-ui/i.test(family)))
      assert.equal(measured.overflowX, false, `overflow-x @${width}x${height} ${locale}`)
      for (const pane of measured.panes) {
        assert.equal(pane.overflow, false, `${pane.name} overflow @${width}`)
        assert.ok(pane.width <= width + 1, `${pane.name} wider than viewport`)
      }
      assert.ok(measured.count >= 10)
      cases += 1
    }
  }

  socket.close()
  console.log(
    `verify-result-numeric-fonts-browser: OK (${cases} locale×viewport cases; family=${cssProbe.sampleFamily})`,
  )
} catch (error) {
  failed = error
} finally {
  chrome.kill()
  staticServer.close()
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}

if (failed) {
  console.error('verify-result-numeric-fonts-browser FAILED:', failed)
  process.exit(1)
}
