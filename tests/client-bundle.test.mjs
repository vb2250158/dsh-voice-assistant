import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import renderer from 'react-test-renderer'

test('built client registers a standalone sidebar entry with a preset prompt', async () => {
  const script = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  let descriptor, registered, component, panel
  const window = { __ModuleLoader__: { load(value) { descriptor = value } } }
  const document = { hidden:false, addEventListener() {}, removeEventListener() {} }
  runInNewContext(script, { window, document, console, AbortController, setTimeout, clearTimeout, setInterval, clearInterval })
  const primitives = { Button: props => React.createElement('button', props, props.children),
    IconMicrophoneOutlineRegular: () => null, Input: props => React.createElement('input', props), Modal: props => props.open ? React.createElement('section', null, props.children) : null }
  const plugin = descriptor.factory(name => name === 'react' ? React : name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : assert.fail(`Unexpected module: ${name}`))
  const form = { getSnapshot: () => ({ status:'ready', value:{ agentPreset:'' } }), async set() { return true } }
  const ctx = { effect(fn) { return fn() }, locale:{ register() { return () => {} }, bind() { return key => key } }, configForms:{ get:() => form, describe:() => ({ getSnapshot:() => ({}) }) },
    sessions:{}, remote:{ speech:{} }, slots:{ inject(_name, fn) { return fn() }, register(spec, view) { if (spec.name === 'main') { registered=spec; component=view } else { panel=spec }; return () => {} } } }
  plugin.apply(ctx)
  assert.equal(registered.name, 'main'); assert.equal(registered.key, 'dsh-voice-assistant'); assert.equal(panel.name, 'sidebar.panellist'); assert.equal(panel.id, registered.key)
  const labels = { title:'Voice assistant', open:'Open voice assistant', needPreset:'Choose an assistant preset before opening.',
    preset:'Assistant preset', save:'Save preset', retry:'Open assistant', close:'Close' }
  let view
  renderer.act(() => { view=renderer.create(React.createElement(component, { wide:true, t:key=>labels[key] || key })) })
  renderer.act(() => { view.root.findByType('button').props.onClick() })
  assert.ok(view.root.findAllByType('p').some(item => item.children.includes(labels.needPreset)))
  assert.equal(view.root.findAllByType('input').length, 1)
  view.unmount()
})
