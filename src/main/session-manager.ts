import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { ITransport, SpawnOptions } from './transports/types'
import type { Environment, HostType, Project, SendAttachment, StreamJsonEvent, UserContentBlock } from '../shared/types'
import { parseStreamJsonLine } from './stream-json-parser'
import { validateAttachments } from './attachment-limits'
// Aliased on import so the parameter-property `resolveTransport` doesn't
// shadow it in its own default expression. The right-hand side of
// `(resolveTransport = resolveTransport)` would otherwise hit a TDZ
// ReferenceError at construction time and cascade into the main process
// failing to register IPC handlers — which presents to the user as a
// blank sidebar.
import { resolveTransport as defaultResolveTransport } from './transports'

type EventCallback = (channel: string, payload: unknown) => void

interface ActiveSession {
  sessionId: string
  projectId: string
  process: ChildProcess
  lineBuffer: string
  markedReady: boolean
  stopping: boolean
  exited: Promise<void>
}

const SHUTDOWN_GRACE_MS = 1500

// Some claude versions / hook configurations never emit system:init.
// If we haven't transitioned to ready within this window, do it anyway.
const READY_FALLBACK_MS = 5000

// Bound the per-session accumulators. Stream-json events are line-delimited;
// 4 MiB is multiple orders of magnitude above any legitimate single line and
// guards against a runaway / corrupted stream pinning RAM. stderr is only
// surfaced in the exit-error message, so a smaller cap keeps the UI string
// readable.
const MAX_LINE_BUFFER_BYTES = 4 * 1024 * 1024
const MAX_STDERR_BYTES = 16 * 1024

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>()

  public constructor(
    private readonly resolveTransport: (host: HostType) => ITransport = defaultResolveTransport,
    private readonly onEvent: EventCallback = () => {}
  ) {}

  public async startSession(env: Environment, project: Project, resumeSessionId?: string): Promise<string> {
    const sessionId = randomUUID()
    const transport = this.resolveTransport(env.config)
    const spawnOptions: SpawnOptions = {
      host: env.config,
      path: project.path,
      // Project override wins; otherwise inherit the env's default model.
      model: project.model ?? env.defaultModel,
      resumeSessionId
    }

    this.onEvent('session:status', { sessionId, status: 'starting' })

    // Async pre-flight: refuse to start a session if `claude --version` doesn't
    // print the Claude Code CLI banner over this transport. Without this we'd
    // just spawn whatever and watch the user sit through the 5s ready
    // fallback into a forever-thinking state with no response.
    try {
      const probe = await transport.probe(env.config)
      if (!probe.ok) {
        this.onEvent('session:status', { sessionId, status: 'error', errorMessage: probe.reason })
        return sessionId
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'probe failed'
      this.onEvent('session:status', { sessionId, status: 'error', errorMessage: reason })
      return sessionId
    }

    const process = transport.spawn(spawnOptions)

    let stderrBuffer = ''
    let resolveExited!: () => void
    const exited = new Promise<void>((resolve) => { resolveExited = resolve })
    const session: ActiveSession = {
      sessionId,
      projectId: project.id,
      process,
      lineBuffer: '',
      markedReady: false,
      stopping: false,
      exited
    }
    this.sessions.set(sessionId, session)

    const markReady = () => {
      if (session.markedReady) return
      session.markedReady = true
      // Once we've transitioned to ready (either from system:init or from the
      // first assistant/result event), the fallback timer is dead weight —
      // clear it so it doesn't keep the event loop alive for the full
      // READY_FALLBACK_MS window after every session start.
      clearTimeout(readyTimer)
      this.onEvent('session:status', { sessionId, status: 'ready' })
    }

    // Fallback: if init event never arrives, mark ready after timeout
    const readyTimer = setTimeout(markReady, READY_FALLBACK_MS)

    let spawnError: string | null = null

    process.stdout?.on('data', (chunk: Buffer) => this.handleStdout(session, chunk, markReady))
    process.stderr?.on('data', (chunk: Buffer) => {
      // Bound stderr capture so a chatty / runaway claude can't pin memory.
      // Past the cap we just drop further bytes — the exit-error message only
      // surfaces a tail of this anyway.
      if (stderrBuffer.length >= MAX_STDERR_BYTES) return
      stderrBuffer += chunk.toString('utf-8')
      if (stderrBuffer.length > MAX_STDERR_BYTES) {
        stderrBuffer = stderrBuffer.slice(0, MAX_STDERR_BYTES)
      }
    })
    // EPIPE / write errors after the child exits surface here — keep ignoring
    // those, but capture the spawn failure (ENOENT when `claude` is missing
    // from PATH) so we can surface it as an error status.
    process.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        spawnError = `Could not start "claude" — is the Claude Code CLI installed and on PATH?`
      } else if (err.code) {
        spawnError = `Failed to start claude (${err.code}): ${err.message}`
      } else {
        spawnError = err.message || 'Failed to start claude'
      }
    })
    process.stdin?.on('error', () => {})
    process.on('exit', (code) => {
      clearTimeout(readyTimer)
      this.sessions.delete(sessionId)
      resolveExited()
      if (session.stopping) return
      // Treat spawn failures (ENOENT etc.) and non-zero exits as errors so the
      // tab tells the user something went wrong instead of silently going gray.
      const isError = spawnError !== null || (code !== 0 && code !== null)
      // Trim the stderr tail we surface to the renderer — a long error string
      // crowds out the rest of the UI and the user only needs the recent end.
      const stderrTail = stderrBuffer.trim().slice(-2000)
      const errorMessage = spawnError
        ?? (isError
          ? `Process exited with code ${code}${stderrTail ? `\n${stderrTail}` : ''}`
          : undefined)
      this.onEvent('session:status', {
        sessionId,
        status: isError ? 'error' : 'closed',
        errorMessage
      })
    })

    return sessionId
  }

  public sendMessage(sessionId: string, text: string, attachments: SendAttachment[] = []): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Bound the attachment payload before it lands in the JSON line we write
    // to claude's stdin. Without this, a renderer (or a compromised one) could
    // OOM the main process via base64 inflation. Throws — the IPC wrapper logs
    // and rejects the invoke; the user will see the failure in DevTools rather
    // than have the chat silently swallow their message.
    validateAttachments(attachments)
    const content = attachments.length === 0
      ? text
      : buildContentBlocks(text, attachments)
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content }
    }) + '\n'
    if (!this.writeStdin(sessionId, payload)) return
    // Flip to busy immediately so the renderer can show a "thinking" indicator
    // while we wait for the first stream-json event back from claude.
    this.onEvent('session:status', { sessionId, status: 'busy' })
  }

  public respondPermission(sessionId: string, decision: 'allow' | 'deny', toolUseId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const content = decision === 'allow' ? 'allow' : 'deny'
    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content }]
      }
    }) + '\n'
    this.writeStdin(sessionId, payload)
  }

  // Wrap every stdin write so a closed/destroyed pipe (claude exited between
  // the renderer queueing input and main attempting the write) flips the
  // session to 'error' instead of throwing into the void. Returns true if
  // the write was issued, false if the pipe was unavailable and the caller
  // should bail out of any post-write side-effects (status flips, etc.).
  private writeStdin(sessionId: string, payload: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    const stdin = session.process.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) {
      this.onEvent('session:status', {
        sessionId,
        status: 'error',
        errorMessage: 'Connection to claude was lost. Close the tab and reopen the project to retry.'
      })
      return false
    }
    try {
      stdin.write(payload)
      return true
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'write to claude stdin failed'
      this.onEvent('session:status', { sessionId, status: 'error', errorMessage: reason })
      return false
    }
  }

  public stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.stopping = true
    session.process.kill()
    this.sessions.delete(sessionId)
    this.onEvent('session:status', { sessionId, status: 'closed' })
  }

  // Abort the current in-flight turn without killing the process. We send
  // claude's stream-json control_request/interrupt over stdin instead of
  // posix-signalling the child:
  //
  //   1. On Windows, Node's kill('SIGINT') is just TerminateProcess under
  //      the hood — there are no real signals — so the "interrupt" was in
  //      fact killing claude every time.
  //   2. For WSL / SSH transports the OS child is wsl.exe / ssh.exe, not
  //      claude itself; signalling those tears down the whole transport
  //      connection (the symptom the user reported: "Stop closes the chat
  //      instead of stopping the message").
  //
  // The control_request shape comes from the Claude Agent SDK's stream-json
  // protocol. We don't track the response (control_response) — the renderer
  // just needs the spinner cleared, and the next assistant/result event will
  // confirm the turn ended.
  public interruptSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const payload = JSON.stringify({
      type: 'control_request',
      request_id: `req_${randomUUID()}`,
      request: { subtype: 'interrupt' }
    }) + '\n'
    // Best-effort write: don't go through writeStdin (which would flip the
    // session to 'error' on a broken pipe). If the pipe is gone the next
    // exit handler will surface that on its own; nothing useful to do here.
    const stdin = session.process.stdin
    if (stdin && !stdin.destroyed && stdin.writable) {
      try { stdin.write(payload) } catch { /* swallow — session is winding down */ }
    }
    this.onEvent('session:status', { sessionId, status: 'ready' })
  }

  public async stopAll(): Promise<void> {
    const live: ActiveSession[] = []
    for (const session of this.sessions.values()) {
      session.stopping = true
      try { session.process.kill() } catch { /* already dead */ }
      live.push(session)
    }
    this.sessions.clear()
    if (!live.length) return
    const allExited = Promise.all(live.map(s => s.exited)).then(() => undefined)
    const grace = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))
    await Promise.race([allExited, grace])
    // SIGTERM is advisory — a child blocked on a hung syscall (stuck SSH,
    // wedged PTY) will sit through it and then through app.exit too. Force
    // SIGKILL on anyone still alive so quit doesn't hang the UI.
    for (const session of live) {
      if (session.process.exitCode !== null || session.process.signalCode !== null) continue
      try { session.process.kill('SIGKILL') } catch { /* already dead */ }
    }
  }

  private handleStdout(session: ActiveSession, chunk: Buffer, markReady: () => void): void {
    session.lineBuffer += chunk.toString('utf-8')
    // If we're still buffering past the cap, we've almost certainly hit a
    // corrupted / non-newline-delimited stream. Kill the session rather than
    // grow forever — the exit handler will surface the failure.
    if (session.lineBuffer.length > MAX_LINE_BUFFER_BYTES) {
      session.lineBuffer = ''
      this.onEvent('session:status', {
        sessionId: session.sessionId,
        status: 'error',
        errorMessage: 'claude produced a malformed stream (single line exceeded buffer cap)'
      })
      try { session.process.kill() } catch { /* already dead */ }
      return
    }
    const lines = session.lineBuffer.split('\n')
    session.lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const event: StreamJsonEvent | null = parseStreamJsonLine(line)
      if (!event) continue

      if (event.type === 'system' && event.subtype === 'init') {
        markReady()
      } else if (event.type === 'result') {
        // A turn finished — back to ready so the spinner clears. We bypass
        // markReady here because that's gated to fire only once.
        session.markedReady = true
        this.onEvent('session:status', { sessionId: session.sessionId, status: 'ready' })
      } else if (event.type === 'assistant') {
        session.markedReady = true
        this.onEvent('session:status', { sessionId: session.sessionId, status: 'busy' })
      }

      this.onEvent('session:event', { sessionId: session.sessionId, event })
    }
  }
}

function buildContentBlocks(text: string, attachments: SendAttachment[]): UserContentBlock[] {
  const blocks: UserContentBlock[] = []
  // Text-file attachments are inlined as fenced code so the model sees them
  // as part of the prompt; binary attachments become real image/document blocks.
  let prelude = ''
  for (const att of attachments) {
    if (att.kind === 'text') {
      const fence = '```'
      const lang = extensionFromName(att.name)
      prelude += `${fence}${lang ? lang : ''}${att.name ? ` ${att.name}` : ''}\n${att.text}\n${fence}\n\n`
    }
  }
  const fullText = prelude + text
  if (fullText) blocks.push({ type: 'text', text: fullText })
  for (const att of attachments) {
    if (att.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: att.mediaType, data: att.data } })
    } else if (att.kind === 'document') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: att.mediaType, data: att.data } })
    }
  }
  return blocks
}

function extensionFromName(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

