import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function componentSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => readFile(join(directory, entry.name), 'utf8'))
  return Promise.all(files)
}

const sources = await componentSources('src/components')
sources.push(await readFile('src/App.tsx', 'utf8'))
const uiSource = sources.join('\n')

/* Unknown exception/API text must never flow directly into JSX or UI state. */
assert.doesNotMatch(uiSource, /\{\s*(?:error|caught|err)\.message\s*\}/)
assert.doesNotMatch(uiSource, /\{\s*String\((?:error|caught|err)\)\s*\}/)
assert.doesNotMatch(uiSource, /\{\s*(?:response|result)\.statusText\s*\}/)
assert.doesNotMatch(uiSource, /set(?:Error|Message)\((?:error|caught|err)\.message\)/)
assert.doesNotMatch(uiSource, /set(?:Error|Message)\(String\((?:error|caught|err)\)\)/)

/* The one generic error prop is only fed a catalog string, never an exception. */
const groupCreate = await readFile('src/components/GroupCreateFlow.tsx', 'utf8')
assert.match(groupCreate, /error=\{failed \? t\.groupCreateError : null\}/)
assert.doesNotMatch(groupCreate, /error=\{(?:caught|error|err)/)

/* Known external failures are reduced to controlled enums/flags before render. */
const groupEntry = await readFile('src/components/GroupEntryShell.tsx', 'utf8')
assert.match(groupEntry, /useState<'nickname' \| 'join' \| null>/)
assert.match(groupEntry, /error === 'nickname' \? t\.groupNicknameError : t\.groupPlayError/)
const duelInvite = await readFile('src/components/DuelInvitePanel.tsx', 'utf8')
const groupInvite = await readFile('src/components/GroupInviteShareScreen.tsx', 'utf8')
for (const source of [duelInvite, groupInvite]) {
  assert.match(source, /'copied'/)
  assert.match(source, /'copy-failed'/)
  assert.match(source, /'share-failed'/)
  assert.doesNotMatch(source, /\.message\s*[})]/)
}

console.log('verify-message-display-safety: all checks passed')
