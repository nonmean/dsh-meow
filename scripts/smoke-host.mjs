/**
 * Host-half smoke test for dsh-meow.
 *
 * Mounts the built lib/index.js with a minimal fake Cordis context, exercises
 * every observation point and both /meow routes, and asserts the queue,
 * settings, cooldown, and subagent filtering. No DSH runtime is required.
 *
 *   node scripts/smoke-host.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'dsh-meow-smoke-'))
process.env.DSH_HOME = home

const moduleUrl = pathToFileURL(new URL('../lib/index.js', import.meta.url).pathname).href
const plugin = await import(moduleUrl)
assert.equal(plugin.name, 'dsh-meow')
assert.equal(typeof plugin.apply, 'function')

const handlers = new Map()
const routes = new Map()
const ctx = {
  get: () => undefined,
  logger: { info: () => {}, warn: () => {} },
  on: (event, listener) => {
    const list = handlers.get(event) ?? []
    list.push(listener)
    handlers.set(event, list)
    return () => {}
  },
  inject: (_deps, callback) => {
    callback({
      effect: (body) => { body() },
      webServer: {
        register: (route) => {
          routes.set(route.path, route)
          return () => {}
        },
      },
    })
  },
}

plugin.apply(ctx)
assert.ok(routes.has('/meow/state'), 'state route registered')
assert.ok(routes.has('/meow/events'), 'events route registered')

function emit(event, ...args) {
  for (const listener of handlers.get(event) ?? []) listener(...args)
}

async function call(path, method, body) {
  const route = routes.get(path.split('?')[0])
  assert.ok(route, 'route exists: ' + path)
  const req = {
    method,
    url: path,
    headers: {},
    on(event, listener) {
      if (event === 'data' && body !== undefined) listener(Buffer.from(JSON.stringify(body)))
      if (event === 'end') listener()
      return this
    },
  }
  let status = 0
  let text = ''
  const res = {
    writeHead: (code) => { status = code },
    end: (value) => { text = value },
  }
  await route.handler(req, res)
  await new Promise(resolve => setTimeout(resolve, 0))
  return { status, body: text === '' ? undefined : JSON.parse(text) }
}

const topLevel = { header: {} }
const child = { header: { delegationDepth: 1, parentSession: 'session-parent' } }
const neverDelegates = () => Promise.resolve('unavailable')

// (a) confirmation needed via the approval waterfall.
emit('approval/request', {}, neverDelegates)
// (b) input needed via the question waterfall.
emit('user-questions/request', {}, neverDelegates)
// (d) task done.
emit('session/event', topLevel, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
// (c) something wrong.
emit('session/event', topLevel, { type: 'turn/end', data: { reason: { kind: 'error' } } })
// A child session is filtered out while includeSubagents is false.
emit('session/event', child, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
// An aborted turn is neither done nor an error.
emit('session/event', topLevel, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })

const first = await call('/meow/events?since=0', 'GET')
assert.equal(first.status, 200)
assert.deepEqual(first.body.value.events.map(event => event.kind), ['approval', 'question', 'done', 'error'])
assert.equal(first.body.value.cursor, 4)
assert.equal(first.body.value.state.enabled, true)

// A first poll without a cursor adopts the cursor without replaying.
const adoption = await call('/meow/events', 'GET')
assert.deepEqual(adoption.body.value.events, [])
assert.equal(adoption.body.value.cursor, 4)

// Cooldown: a second identical kind within the window is dropped.
emit('session/event', topLevel, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
const cooled = await call('/meow/events?since=4', 'GET')
assert.deepEqual(cooled.body.value.events, [])

// Settings write: disable silences every kind.
const disabled = await call('/meow/state', 'POST', { enabled: false, volume: 0.25 })
assert.equal(disabled.status, 200)
assert.equal(disabled.body.value.enabled, false)
assert.equal(disabled.body.value.volume, 0.25)
assert.ok(existsSync(join(home, 'dsh-meow.json')), 'state file written')
assert.equal(JSON.parse(readFileSync(join(home, 'dsh-meow.json'), 'utf8')).enabled, false)

emit('session/event', topLevel, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
const silenced = await call('/meow/events?since=4', 'GET')
assert.deepEqual(silenced.body.value.events, [])

// Re-enable, then let the subagent opt-in admit a child turn.
const enabled = await call('/meow/state', 'POST', { enabled: true, includeSubagents: true })
assert.equal(enabled.body.value.enabled, true)
assert.equal(enabled.body.value.includeSubagents, true)
// Clear the per-kind cooldown set by the cooldown assertion above.
await new Promise(resolve => setTimeout(resolve, 650))
emit('session/event', child, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
const opted = await call('/meow/events?since=4', 'GET')
assert.deepEqual(opted.body.value.events.map(event => event.kind), ['done'])

// Reading state back returns the persisted document.
const readBack = await call('/meow/state', 'GET')
assert.equal(readBack.body.value.volume, 0.25)
assert.equal(readBack.body.value.includeSubagents, true)

// An invalid patch leaves the field unchanged rather than resetting it.
const invalid = await call('/meow/state', 'POST', { volume: 'loud', enabled: 'yes' })
assert.equal(invalid.body.value.volume, 0.25)
assert.equal(invalid.body.value.enabled, true)

console.log('dsh-meow host smoke: OK')
