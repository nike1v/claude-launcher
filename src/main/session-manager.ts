import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { ITransport, SpawnOptions } from './transports/types'
import type { Environment, HostType, Project, SendAttachment } from '../shared/types'
import { validateAttachments } from './attachment-limits'
// Aliased on import so the parameter-property `resolveTransport` doesn't
// shadow it in its own default expression. The right-hand side of
// `(resolveTransport = resolveTransport)` would otherwise hit a TDZ
// ReferenceError at construction time and cascade into the main process
// failing to register IPC handlers — which presents to the user as a
// blank sidebar.
import { resolveTransport as defaultResolveTransport } from './transports'
import { getProvider } from './providers/registry'
import type { IProvider, IProviderAdapter } from './providers/types'
import { resolveProviderKind, type NormalizedEvent } from '../shared/events'

type EventCallback = (channel: string, payload: unknown) => void

interface ActiveSession {
  sessionId: string
  projectId: string
  process: ChildProcess
  // Provider this session was spawned with — pinned at start so a
  // mid-flight providerKind change on the project doesn't confuse
  // sendMessage / interrupt / respondPermission.
  provider: IProvider
  // Per-session adapter that translates provider stdout into
  // NormalizedEvent. Stateful (line buffer, current turnId, tool_use
  // ↔ item.id pairings) so each session has its own.
  adapter: IProviderAdapter
  lineBuffer: string
  markedReady: boolean
  stopping: boolean
  exited: Promise<void>
  // Held on the session so handleStdout can clear it from a turn-completed
  // event without us having to thread the closure variable through.
  readyTimer: NodeJS.Timeout | null
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

  // Returns the renderer-visible sessionId immediately so the IPC promise
  // resolves before the SSH probe even starts. The slow stuff — probe and
  // spawn — runs in background via _runSession; status events flow over
  // the IPC channel as the work progresses, so the renderer can paint a
  // 'starting' tab the moment the user clicks (or the moment restoreTabs
  // calls addSession), instead of staring at an empty TabBar through a
  // 5–10 s cold SSH probe.
  public startSession(env: Environment, project: Project, resumeSessionId?: string): string {
    const sessionId = randomUUID()
    this.onEvent('session:status', { sessionId, status: 'starting' })
    void this._runSession(sessionId, env, project, resumeSessionId).catch(err => {
      const reason = err instanceof Error ? err.message : 'session start failed'
      this.onEvent('session:status', { sessionId, status: 'error', errorMessage: reason })
    })
    return sessionId
  }

  private async _runSession(
    sessionId: string,
    env: Environment,
    project: Project,
    resumeSessionId?: string
  ): Promise<void> {
    const transport = this.resolveTransport(env.config)
    const provider = getProvider(resolveProviderKind({
      projectKind: project.providerKind,
      envKind: env.providerKind
    }))
    const built = provider.buildSpawnArgs({
      cwd: project.path,
      // Project override wins; otherwise inherit the env's default model.
      model: project.model ?? env.defaultModel,
      resumeRef: resumeSessionId
    })
    const spawnOptions: SpawnOptions = {
      host: env.config,
      path: project.path,
      bin: built.bin,
      args: built.args,
      envScrubKeys: provider.envScrubList(env.config)
    }

    // Pre-flight: refuse to start a session if the provider's binary
    // doesn't probe successfully on this transport. Without this we'd
    // just spawn whatever and watch the user sit through the 5 s ready
    // fallback into a forever-thinking state with no response.
    try {
      const probe = await transport.probe(env.config, provider.probeOptions())
      if (!probe.ok) {
        this.onEvent('session:status', { sessionId, status: 'error', errorMessage: probe.reason })
        return
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'probe failed'
      this.onEvent('session:status', { sessionId, status: 'error', errorMessage: reason })
      return
    }

    const process = transport.spawn(spawnOptions)

    let stderrBuffer = ''
    let resolveExited!: () => void
    const exited = new Promise<void>((resolve) => { resolveExited = resolve })
    const session: ActiveSession = {
      sessionId,
      projectId: project.id,
      process,
      provider,
      adapter: provider.createAdapter(),
      lineBuffer: '',
      markedReady: false,
      stopping: false,
      exited,
      readyTimer: null
    }
    this.sessions.set(sessionId, session)

    const markReady = () => {
      if (session.markedReady) return
      session.markedReady = true
      // Once we've transitioned to ready (either from system:init or from the
      // first assistant/result event), the fallback timer is dead weight —
      // clear it so it doesn't keep the event loop alive for the full
      // READY_FALLBACK_MS window after every session start.
      if (session.readyTimer) {
        clearTimeout(session.readyTimer)
        session.readyTimer = null
      }
      this.onEvent('session:status', { sessionId, status: 'ready' })
    }

    // Fallback: if init event never arrives, mark ready after timeout
    session.readyTimer = setTimeout(markReady, READY_FALLBACK_MS)

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
        spawnError = `Could not start "${built.bin}" — is the ${provider.label} CLI installed and on PATH?`
      } else if (err.code) {
        spawnError = `Failed to start ${built.bin} (${err.code}): ${err.message}`
      } else {
        spawnError = err.message || `Failed to start ${built.bin}`
      }
    })
    process.stdin?.on('error', () => {})

    // Stateful protocols (codex JSON-RPC) need a handshake written
    // immediately on spawn — initialize request, etc. Stateless
    // protocols (claude stream-json) return '' and this is a no-op.
    const startup = session.adapter.startupBytes({
      cwd: project.path,
      model: project.model ?? env.defaultModel,
      resumeRef: resumeSessionId
    })
    if (startup) this.writeStdin(sessionId, startup)

    process.on('exit', (code) => {
      if (session.readyTimer) {
        clearTimeout(session.readyTimer)
        session.readyTimer = null
      }
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
  }

  public sendMessage(sessionId: string, text: string, attachments: SendAttachment[] = []): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Bound the attachment payload before it lands in the JSON line we
    // write to the provider's stdin. Without this, a renderer (or a
    // compromised one) could OOM the main process via base64 inflation.
    // Throws — the IPC wrapper logs and rejects the invoke; the user will
    // see the failure in DevTools rather than have the chat silently
    // swallow their message.
    validateAttachments(attachments)
    const payload = session.adapter.formatUserMessage(text, attachments)
    if (!this.writeStdin(sessionId, payload)) return
    this.drainAdapterWrites(session)
    // Flip to busy immediately so the renderer can show a "thinking"
    // indicator while we wait for the first stream-json event back.
    this.onEvent('session:status', { sessionId, status: 'busy' })
  }

  public respondPermission(sessionId: string, decision: 'allow' | 'deny', toolUseId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const payload = session.adapter.formatControl({
      kind: 'approval',
      requestId: toolUseId,
      decision: decision === 'allow' ? 'accept' : 'decline'
    })
    if (payload === null) return
    this.writeStdin(sessionId, payload)
    this.drainAdapterWrites(session)
  }

  // Drain bytes the adapter queued asynchronously (e.g. after parsing a
  // JSON-RPC response, the codex adapter queues the next request in
  // its bootstrap chain). Called after every adapter call that might
  // affect its internal queue.
  private drainAdapterWrites(session: ActiveSession): void {
    const pending = session.adapter.drainPendingWrites()
    if (pending) this.writeStdin(session.sessionId, pending)
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

  // Abort the current in-flight turn without killing the process. We
  // delegate to the provider's formatControl({kind: 'interrupt'}) — for
  // claude that returns a stream-json control_request line; other
  // providers may return something else (or null, in which case we'd
  // SIGINT instead — not yet exercised since claude is the only provider).
  //
  // Why in-band instead of posix-signalling the child:
  //   1. On Windows, Node's kill('SIGINT') is just TerminateProcess under
  //      the hood — there are no real signals — so the "interrupt" was
  //      in fact killing the CLI every time.
  //   2. For WSL / SSH transports the OS child is wsl.exe / ssh.exe, not
  //      the CLI itself; signalling those tears down the whole transport
  //      connection (the symptom the user reported: "Stop closes the
  //      chat instead of stopping the message").
  // Stop the current action. Mirrors claude CLI's ESC: write the
  // provider's in-band interrupt protocol message and trust the CLI to
  // process it. Status stays 'busy' until claude actually emits
  // turn.completed — if it never does (wedged session), the renderer's
  // stale-busy hint tells the user to close the tab manually. We
  // intentionally don't kill the child here: signalling tears down the
  // WSL/SSH wrapper, which closes the whole chat instead of just
  // aborting the turn (the v0.4.4 bug). Tab close already handles
  // teardown cleanly when the user wants out.
  public interruptSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const payload = session.adapter.formatControl({ kind: 'interrupt' })
    if (payload === null) return
    const stdin = session.process.stdin
    if (stdin && !stdin.destroyed && stdin.writable) {
      try { stdin.write(payload) } catch { /* pipe gone; exit handler surfaces it */ }
    }
    this.drainAdapterWrites(session)
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
    // corrupted / non-newline-delimited stream. Kill the session rather
    // than grow forever — the exit handler will surface the failure.
    if (session.lineBuffer.length > MAX_LINE_BUFFER_BYTES) {
      session.lineBuffer = ''
      this.onEvent('session:status', {
        sessionId: session.sessionId,
        status: 'error',
        errorMessage: `${session.provider.label} produced a malformed stream (single line exceeded buffer cap)`
      })
      try { session.process.kill() } catch { /* already dead */ }
      return
    }
    const lines = session.lineBuffer.split('\n')
    session.lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      // adapter.parseChunk takes a chunk; feeding it one complete line
      // at a time keeps its own internal buffer empty after every call.
      const events = session.adapter.parseChunk(line + '\n')
      // Drain any follow-up writes the adapter queued in response to
      // what it just parsed (codex bootstrap chain queues `initialized`
      // + `thread/start` after seeing the `initialize` response).
      this.drainAdapterWrites(session)
      if (events.length === 0) continue

      // Status transitions fire individually so the busy/ready timing
      // matches the actual turn boundary inside the chunk. The bulk of
      // the events is delivered in a single batched IPC at the end.
      for (const event of events) {
        this.applyStatusTransition(session, event, markReady)
      }
      this.onEvent('session:event', { sessionId: session.sessionId, events })
    }
  }

  private applyStatusTransition(
    session: ActiveSession,
    event: NormalizedEvent,
    markReady: () => void
  ): void {
    if (event.kind === 'session.started') {
      markReady()
      return
    }
    if (event.kind === 'turn.started') {
      // A new turn opened — flip to busy so the renderer shows the
      // thinking spinner. Bypass markReady's once-only gate so this
      // fires every turn, but still clear the fallback timer.
      session.markedReady = true
      if (session.readyTimer) {
        clearTimeout(session.readyTimer)
        session.readyTimer = null
      }
      this.onEvent('session:status', { sessionId: session.sessionId, status: 'busy' })
      return
    }
    if (event.kind === 'turn.completed') {
      // Turn finished — back to ready so the spinner clears.
      session.markedReady = true
      if (session.readyTimer) {
        clearTimeout(session.readyTimer)
        session.readyTimer = null
      }
      this.onEvent('session:status', { sessionId: session.sessionId, status: 'ready' })
    }
  }
}
