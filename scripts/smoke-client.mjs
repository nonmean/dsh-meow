/**
 * Browser-half smoke test for dsh-meow.
 *
 * Evaluates the built lib/client.js as a classic script with a fake
 * window.__ModuleLoader__, then invokes the factory and apply() with a minimal
 * fake client context. Asserts the plugin registers the General-settings row,
 * installs the zh/en dictionaries, starts the /meow/events poll, and subscribes
 * to the first-gesture audio unlock. No browser is required.
 *
 *   node scripts/smoke-client.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let registration
const windowListeners = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => { registration = value },
  },
  addEventListener: (type, listener) => { windowListeners.set(type, listener) },
  removeEventListener: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
}
// Evaluate the bundle exactly as the browser's module loader would.
new Function(source)()
assert.ok(registration, 'bundle registered itself')
assert.equal(registration.id, 'dsh-meow')

const reactStub = { useSyncExternalStore: () => 'en' }
const jsxStub = { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
const clientModule = registration.factory((specifier) => {
  if (specifier === 'react') return reactStub
  if (specifier === 'react/jsx-runtime') return jsxStub
  throw new Error('unexpected require: ' + specifier)
})
assert.equal(typeof clientModule.apply, 'function')
assert.ok(Array.isArray(clientModule.inject))

const registrations = []
const effects = []
const dictionaries = []
const uiCtx = {
  effect: (fn) => { effects.push(fn()) },
  slots: {
    inject: (_key, callback) => { callback() },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  locale: {
    getSnapshot: () => ({ active: 'en' }),
    subscribe: () => () => {},
    register: (ns, locale, dict) => {
      dictionaries.push({ ns, locale, dict })
      return () => {}
    },
  },
}
const ctx = {
  inject: (_deps, callback) => { callback(uiCtx) },
  effect: (fn) => { effects.push(fn()) },
}

const fetches = []
globalThis.fetch = async (url) => {
  fetches.push(String(url))
  return {
    json: async () => ({
      ok: true,
      value: {
        events: [],
        cursor: 0,
        state: {
          enabled: true,
          onApproval: true,
          onQuestion: true,
          onError: true,
          onDone: true,
          includeSubagents: false,
          volume: 0.5,
        },
      },
    }),
  }
}

clientModule.apply(ctx)

assert.deepEqual(registrations.map(entry => entry.options.name), ['settings.general.item'])
assert.equal(registrations[0].options.id, 'meow')
assert.equal(typeof registrations[0].component, 'function')
assert.deepEqual(dictionaries.map(entry => entry.locale).sort(), ['en', 'zh'])

await new Promise(resolve => setTimeout(resolve, 10))
assert.ok(fetches.some(url => url.startsWith('/meow/events')), 'event poll started')
assert.ok(windowListeners.has('pointerdown') && windowListeners.has('keydown'), 'audio unlock installed')
assert.ok(effects.length >= 3, 'poll, dictionaries, and audio unlock registered disposers')

console.log('dsh-meow client smoke: OK')
