import assert from 'node:assert/strict'

const viewportList = [
  [320, 568],
  [375, 667],
  [390, 844],
  [768, 1024],
  [1280, 800],
]

const target = await fetch(
  'http://127.0.0.1:9222/json/new?http://127.0.0.1:5173',
  { method: 'PUT' },
).then((response) => response.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
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
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text)
  }
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await new Promise((resolve) => setTimeout(resolve, 800))

await evaluate(`localStorage.setItem('3cb.language', 'en'); location.reload()`)
await new Promise((resolve) => setTimeout(resolve, 800))
assert.equal(await evaluate('document.documentElement.lang'), 'en')
await evaluate(`document.querySelector('.lang-toggle').click()`)
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal(await evaluate('document.documentElement.lang'), 'ja')

const measurements = []
for (const [width, height] of viewportList) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  })

  for (const variant of ['known-0', 'known-1', 'known-2', 'known-3']) {
    const byLocale = {}
    for (const locale of ['en', 'ja']) {
      byLocale[locale] = await evaluate(`(async () => {
        const strings = (await import('/src/i18n/${locale}.ts')).${locale}
        document.documentElement.lang = '${locale}'
        const caseIndex = Number('${variant}'.slice(-1))
        const pick = (values) => values[caseIndex % values.length]
        const feedback = pick([strings.duelInviteCopied, strings.duelInviteCopyFailed, strings.duelInviteShareFailed])
        const play = pick([strings.duelOpenRetry, strings.duelCashOutRetry, strings.duelResultError, strings.groupPlayError])
        const waiting = pick([strings.groupProgressError, strings.groupResultError])
        const detail = pick([strings.duelMatchDetailError, strings.groupDetailError])
        const guide = pick([strings.duelAddToHomeGuideIos, strings.duelAddToHomeGuideAndroid, strings.duelAddToHomeGuideGeneric])
        document.body.innerHTML = \`
          <main id="locale-fixture" style="width:min(100%,30rem);margin:0 auto;display:flex;flex-direction:column;gap:.5rem">
            <section style="display:flex;flex-direction:column;gap:.4rem">
              <p id="feedback" class="duel-invite-feedback stable-message-slot stable-message-slot--feedback">\${feedback}</p>
              <button id="feedback-button" class="duel-btn">NEXT</button>
            </section>
            <section style="display:flex;flex-direction:column;gap:.4rem">
              <div id="play" class="duel-play-error stable-message-slot stable-message-slot--play-error"><p>\${play}</p></div>
              <button id="play-button" class="duel-btn">ACTION</button>
            </section>
            <section style="display:flex;flex-direction:column;gap:.4rem">
              <p id="waiting" class="duel-lock-error stable-message-slot stable-message-slot--waiting-error">\${waiting}</p>
              <button id="waiting-close" class="duel-btn group-completion-waiting__close">CLOSE GROUP</button>
              <button id="waiting-retry" class="duel-btn">TRY AGAIN</button>
            </section>
            <section class="duel-match-detail-error" style="padding:.25rem 0">
              <p id="detail" class="duel-match-detail-error__copy stable-message-slot stable-message-slot--detail-error">\${detail}</p>
              <div class="duel-match-detail-error__actions"><button id="detail-button" class="duel-btn">TRY AGAIN</button></div>
            </section>
          </main>
          <div id="modal-overlay" class="duel-home-install-overlay">
            <div id="modal-panel" class="duel-home-install-panel">
              <p id="guide" class="duel-home-install-copy">\${guide}</p>
              <button id="modal-button" class="duel-btn">CLOSE</button>
            </div>
          </div>
        \`
        const rect = (id) => {
          const value = document.getElementById(id).getBoundingClientRect()
          return { top: value.top, bottom: value.bottom, height: value.height, width: value.width, center: value.top + value.height / 2 }
        }
        const overflow = (id) => {
          const element = document.getElementById(id)
          return {
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowY: getComputedStyle(element).overflowY,
            text: element.textContent,
          }
        }
        return {
          buttons: Object.fromEntries(['feedback-button','play-button','waiting-close','waiting-retry','detail-button','modal-button','modal-panel'].map((id) => [id, rect(id)])),
          messages: Object.fromEntries(['feedback','play','waiting','detail','guide'].map((id) => [id, overflow(id)])),
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
          pageScrollable: document.documentElement.scrollHeight > innerHeight,
          modalScrollable: document.getElementById('modal-overlay').scrollHeight > document.getElementById('modal-overlay').clientHeight,
        }
      })()`)
    }

    for (const id of Object.keys(byLocale.en.buttons)) {
      for (const metric of ['top', 'bottom', 'height', 'width', 'center']) {
        const delta = Math.abs(byLocale.en.buttons[id][metric] - byLocale.ja.buttons[id][metric])
        assert.ok(delta < 0.01, `${width}x${height} ${variant} ${id}.${metric}: ${delta}px`)
      }
    }
    assert.ok(byLocale.en.horizontalOverflow <= 0, `${width}x${height} EN horizontal overflow`)
    assert.ok(byLocale.ja.horizontalOverflow <= 0, `${width}x${height} JA horizontal overflow`)
    for (const locale of ['en', 'ja']) {
      for (const [id, message] of Object.entries(byLocale[locale].messages)) {
        assert.ok(message.text.length > 0, `${locale} ${variant} ${id} keeps full text`)
        assert.ok(!['auto', 'scroll'].includes(message.overflowY), `${locale} ${variant} ${id} has no internal scroll`)
        assert.ok(message.scrollHeight - message.clientHeight <= 1, `${locale} ${variant} ${id} grows with its text`)
      }
    }
    measurements.push({ width, height, variant, byLocale })
  }
}

const summary = measurements.map(({ width, height, variant, byLocale }) => ({
  viewport: `${width}x${height}`,
  variant,
  maxButtonDelta: Math.max(...Object.keys(byLocale.en.buttons).flatMap((id) =>
    ['top', 'bottom', 'height', 'center'].map((metric) =>
      Math.abs(byLocale.en.buttons[id][metric] - byLocale.ja.buttons[id][metric]),
    ),
  )),
  horizontalOverflow: Math.max(byLocale.en.horizontalOverflow, byLocale.ja.horizontalOverflow),
}))
console.log(JSON.stringify(summary, null, 2))
socket.close()
