/** Maximum wait for gameplay HTTP requests before recovery may proceed. */
export const PLAY_REQUEST_TIMEOUT_MS = 12_000

export class PlayRequestTimeoutError extends Error {
  constructor() {
    super('The gameplay request timed out.')
    this.name = 'PlayRequestTimeoutError'
  }
}

/** Hard deadline even when a custom fetch ignores AbortSignal. */
export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = PLAY_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new PlayRequestTimeoutError())
    }, Math.max(0, timeoutMs))
  })
  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timedOut,
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
