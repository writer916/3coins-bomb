import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const viewports = [[320, 568], [375, 667], [390, 844], [414, 896], [1280, 800]]
const target = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:5173', {
  method: 'PUT',
}).then((response) => response.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let commandId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const screenshotDir = join(tmpdir(), '3cb-daily-prestart-layout-verify')
mkdirSync(screenshotDir, { recursive: true })
const report = []

await send('Page.enable')
await send('Runtime.enable')

for (const [width, height] of viewports) {
  const byLocale = {}
  for (const locale of ['ja', 'en']) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    })
    await send('Page.navigate', { url: 'http://127.0.0.1:5173' })
    await wait(600)
    await evaluate(`localStorage.setItem('3cb.language', '${locale}'); location.reload()`)
    await wait(700)
    await evaluate(`
      [...document.querySelectorAll('.mode-card')]
        .find((element) => element.textContent.includes('DAILY CHALLENGE'))
        .click()
    `)
    await wait(900)

    const measured = await evaluate(`(() => {
      const query = (selector) => document.querySelector(selector)
      const rect = (element) => {
        const value = element.getBoundingClientRect()
        return { top: value.top, bottom: value.bottom, width: value.width, height: value.height }
      }
      const prose = query('.daily-prestart__prose')
      const period = query('.daily-prestart__period')
      const paragraphs = [...prose.querySelectorAll('p')]
      const paragraphRects = paragraphs.map(rect)
      const background = getComputedStyle(query('.app--daily-prestart'), '::before')
      return {
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        background: [background.position, background.backgroundPosition, background.backgroundSize],
        header: rect(query('.field-header')),
        period: rect(period),
        input: rect(query('#daily-nickname')),
        buttons: rect(query('.duel-button-field')),
        proseOverflowY: getComputedStyle(prose).overflowY,
        clipped: paragraphs.some((element) => element.scrollHeight > element.clientHeight + 1),
        paragraphOverlap: paragraphRects.slice(1).some(
          (value, index) => value.top < paragraphRects[index].bottom - 0.5,
        ),
        followingOverlap: Math.max(...paragraphRects.map((value) => value.bottom)) > rect(period).top + 0.5,
      }
    })()`)

    assert.equal(measured.documentWidth, measured.viewportWidth, `${locale} ${width}: horizontal overflow`)
    assert.equal(measured.background[0], 'fixed', `${locale} ${width}: background is not viewport-fixed`)
    assert.notEqual(measured.proseOverflowY, 'auto', `${locale} ${width}: nested prose scroll`)
    assert.notEqual(measured.proseOverflowY, 'scroll', `${locale} ${width}: nested prose scroll`)
    assert.equal(measured.clipped, false, `${locale} ${width}: clipped paragraph`)
    assert.equal(measured.paragraphOverlap, false, `${locale} ${width}: paragraph overlap`)
    assert.equal(measured.followingOverlap, false, `${locale} ${width}: prose overlaps period`)
    assert.ok(measured.documentHeight >= measured.buttons.bottom, `${locale} ${width}: buttons unreachable`)
    if (height >= 667) {
      assert.ok(measured.documentHeight <= height, `${locale} ${width}: unnecessary page scroll`)
    }

    byLocale[locale] = measured
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    writeFileSync(
      join(screenshotDir, `daily-${locale}-${width}x${height}.png`),
      Buffer.from(screenshot.data, 'base64'),
    )
  }

  for (const key of ['background', 'header', 'period', 'input', 'buttons']) {
    assert.deepEqual(byLocale.ja[key], byLocale.en[key], `${width}x${height}: ${key} differs by locale`)
  }
  report.push({ viewport: `${width}x${height}`, documentHeight: byLocale.ja.documentHeight })
}

socket.close()
console.log('verify-daily-prestart-layout-browser: OK', report)
console.log(`screenshots: ${screenshotDir}`)
