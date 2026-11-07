import * as React from 'react'
import { Button, Input, Modal, IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createDesktopHost } from './desktop-host.mjs'
import { SettingsSchema } from './settings.mjs'

const namespace = 'dsh-voice-assistant'
const en = { title: 'DSH assistant', open: 'Open DSH assistant', close: 'Close', listen: 'Start listening',
  stop: 'Stop voice', send: 'Send', input: 'Message', preset: 'Assistant preset', save: 'Save preset',
  needPreset: 'Choose an assistant preset before opening.', waiting: 'Preparing assistant…', failed: 'Assistant unavailable. Check its preset and speech services.',
  retry: 'Open assistant', unconfirmed: 'Some input needs review.', response: 'Assistant', user: 'You',
  stopped: 'Voice is stopped.', listening: 'Listening', playbackError: 'Voice playback is unavailable.', error: 'Assistant encountered an error.' }
const zh = { title: 'DSH 助手', open: '打开 DSH 助手', close: '关闭', listen: '开始聆听', stop: '停止语音',
  send: '发送', input: '输入消息', preset: '助手预设', save: '保存预设', needPreset: '请先填写助手预设。',
  waiting: '正在准备助手…', failed: '助手不可用，请检查预设和语音服务。', retry: '打开助手', unconfirmed: '有内容需要核对。', response: '助手', user: '我',
  stopped: '语音已停止。', listening: '正在聆听', playbackError: '语音播放不可用。', error: '助手遇到错误。' }

export const inject = ['slots', 'locale', 'configForms', 'sessions', 'remote', 'remote.speech']

/** Register one independent GUI with a single session and voice owner. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }))
  const t = ctx.locale.bind(namespace)
  const form = ctx.configForms.get('dsh-voice-assistant')
  const mirror = ctx.configForms.describe()
  let host, hostPreset
  const readSettings = () => {
    const snapshot = form.getSnapshot()
    const section = mirror.getSnapshot().view?.namespaces.find(entry => entry.ns === 'dsh-voice-assistant')
    const source = snapshot.mode !== 'memory' && section?.value !== undefined ? section.value : snapshot.value
    if (snapshot.status !== 'ready' || source === undefined) throw new Error('ASSISTANT_SETTINGS_UNAVAILABLE')
    return SettingsSchema(source)
  }
  const preferences = () => {
    const value = readSettings()
    return { threshold: value.silenceThreshold, silenceMs: value.silenceDurationMs, sampleMs: value.sampleMs, maxVisibleMessages:value.maxVisibleMessages }
  }
  const getHost = preset => {
    if (host && hostPreset !== preset) { host.close(); host = undefined }
    if (!host) {
      hostPreset = preset
      host = createDesktopHost({ sessions: ctx.sessions, speech: ctx.remote.speech, fetchAudio: globalThis.fetch.bind(globalThis),
        preferences, agentPreset: preset, browser: window, onError: () => {} })
    }
    return host
  }
  ctx.effect(() => () => { host?.close(); host = undefined })
  function AssistantEntry({ t }) {
    const [open, setOpen] = React.useState(false)
    const [current, setCurrent] = React.useState(null)
    const [snapshot, setSnapshot] = React.useState(null)
    const [value, setValue] = React.useState('')
    const [preset, setPreset] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [ready, setReady] = React.useState(false)
    React.useEffect(() => current?.subscribe(() => setSnapshot(current.getSnapshot())), [current])
    React.useEffect(() => () => current?.suspend(), [current])
    React.useEffect(() => {
      const hidden = () => { if (document.hidden) current?.suspend() }
      document.addEventListener('visibilitychange', hidden)
      return () => document.removeEventListener('visibilitychange', hidden)
    }, [current])
    const close = () => { current?.suspend(); setOpen(false) }
    const prepare = async () => {
      let config
      try { config = readSettings() } catch { setMessage(t('failed')); return }
      if (!config.agentPreset) { setMessage(t('needPreset')); return }
      setMessage(t('waiting')); setReady(false)
      try {
        const next = getHost(config.agentPreset)
        setCurrent(next); await next.open(); await next.prepareMicrophone()
        setSnapshot(next.getSnapshot()); setReady(true); setMessage('')
      } catch { setMessage(t('failed')) }
    }
    const show = () => { setOpen(true); try { setPreset(readSettings().agentPreset) } catch { setPreset('') }; void prepare() }
    const save = async () => {
      try { if (!await form.set('agentPreset', preset.trim())) throw new Error('SAVE_REJECTED'); await prepare() }
      catch { setMessage(t('failed')) }
    }
    return React.createElement(React.Fragment, null,
      React.createElement(Button, { variant:'ghost', onClick:show, 'aria-label':t('open') }, t('open')),
      React.createElement(Modal, { open, title:t('title'), closeLabel:t('close'), onClose:close },
        React.createElement('div', { className:'dshVoiceAssistant' },
          message && React.createElement('p', { role:'status' }, message),
          !ready && React.createElement(React.Fragment, null,
            React.createElement('label', null, t('preset'), React.createElement(Input, { value:preset, onChange:event=>setPreset(event.target.value), 'aria-label':t('preset') })),
            React.createElement(Button, { onClick:() => void save() }, t('save')),
            React.createElement(Button, { onClick:() => void prepare() }, t('retry'))),
          ready && React.createElement(React.Fragment, null,
            snapshot?.status === 'listening' && React.createElement('p', { role:'status' }, t('listening')),
            snapshot?.status === 'stopped' && React.createElement('p', { role:'status' }, t('stopped')),
            snapshot?.status === 'playback-error' && React.createElement('p', { role:'alert' }, t('playbackError')),
            snapshot?.status === 'error' && React.createElement('p', { role:'alert' }, t('error')),
            ...((snapshot?.messages || []).map(item => React.createElement('p', { key:item.id }, `${t(item.role === 'user' ? 'user' : 'response')}: ${item.text}`))),
            snapshot?.transcript && React.createElement('p', null, snapshot.transcript),
            snapshot?.pending?.some(item => item.status === 'unconfirmed') && React.createElement('p', { role:'alert' }, t('unconfirmed')),
            React.createElement(Input, { value, onChange:event=>setValue(event.target.value), 'aria-label':t('input') }),
            React.createElement(Button, { onClick:() => { if (current.send(value)) setValue('') } }, t('send')),
            React.createElement(Button, { onClick:() => { try { current.activate() } catch { setMessage(t('failed')) } } }, t('listen')),
            React.createElement(Button, { onClick:() => current.suspend() }, t('stop'))))))
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:namespace, locale:namespace }, AssistantEntry))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:namespace, order:30, locale:namespace, label:() => t('title') }, ({ size }) => React.createElement(IconMicrophoneOutlineRegular, { size })))
}
