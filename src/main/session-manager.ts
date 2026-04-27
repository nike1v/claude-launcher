import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { ITransport, SpawnOptions } from './transports/types'
import type { Project, SendAttachment, StreamJsonEvent, UserContentBlock } from '../shared/types'
import { parseStreamJsonLine } from './stream-json-parser'
import { LocalTransport } from './transports/local'
import { WslTransport } from './transports/wsl'
import { SshTransport } from './transports/ssh'

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

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>()

  public constructor(
    private readonly resolveTransport: (project: Project) => ITransport = resolveDefaultTransport,
    private readonly onEvent: EventCallback = () => {}
  ) {}

  public startSession(project: Project, resumeSessionId?: string): string {
    const sessionId = randomUUID()
    const transport = this.resolveTransport(project)
    const spawnOptions: SpawnOptions = {
      host: project.host,
      path: project.path,
      model: project.model,
      resumeSessionId
    }

    this.onEvent('session:status', { sessionId, status: 'starting' })
    const process = transport.spawn(spawnOptions)

    let stderrBuffer = ''
    let resolveExited!: () => void
    const exited = new Promise<void>((resolve) => { resolveExited = resolve })
    const session: ActiveSession = {
      sessionId, projectId: project.id, process, lineBuffer: '',
      markedReady: false, stopping: false, exited
    }
    this.sessions.set(sessionId, session)

    const markReady = () => {
      if (session.markedReady) return
      session.markedReady = true
      this.onEvent('session:status', { sessionId, status: 'ready' })
    }

    // Fallback: if init event never arrives, mark ready after timeout
    const readyTimer = setTimeout(markReady, READY_FALLBACK_MS)

    process.stdout?.on('data', (chunk: Buffer) => this.handleStdout(session, chunk, markReady))
    process.stderr?.on('data', (chunk: Buffer) => { stderrBuffer += chunk.toString('utf-8') })
    // Swallow EPIPE / write errors that occur when the child exits while we're
    // still streaming — these surface as unhandled errors otherwise.
    process.on('error', () => {})
    process.stdin?.on('error', () => {})
    process.on('exit', (code) => {
      clearTimeout(readyTimer)
      this.sessions.delete(sessionId)
      resolveExited()
      if (session.stopping) return
      const isError = code !== 0 && code !== null
      const errorMessage = isError
        ? `Process exited with code ${code}${stderrBuffer.trim() ? `\n${stderrBuffer.trim()}` : ''}`
        : undefined
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
    const content = attachments.length === 0
      ? text
      : buildContentBlocks(text, attachments)
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content }
    }) + '\n'
    session.process.stdin?.write(payload)
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
    session.process.stdin?.write(payload)
  }

  public stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.stopping = true
    session.process.kill()
    this.sessions.delete(sessionId)
    this.onEvent('session:status', { sessionId, status: 'closed' })
  }

  // Abort the current in-flight turn without killing the process. Claude
  // CLI handles SIGINT by stopping the active LLM call / tool run and
  // returning to the prompt. We also flip the renderer back to 'ready' so
  // the spinner clears even if the CLI doesn't emit an immediate result.
  public interruptSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try { session.process.kill('SIGINT') } catch { /* already exited */ }
    this.onEvent('session:status', { sessionId, status: 'ready' })
  }

  public async stopAll(): Promise<void> {
    const pending: Promise<void>[] = []
    for (const session of this.sessions.values()) {
      session.stopping = true
      try { session.process.kill() } catch { /* already dead */ }
      pending.push(session.exited)
    }
    this.sessions.clear()
    if (!pending.length) return
    const grace = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))
    await Promise.race([Promise.all(pending).then(() => undefined), grace])
  }

  private handleStdout(session: ActiveSession, chunk: Buffer, markReady: () => void): void {
    session.lineBuffer += chunk.toString('utf-8')
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

function resolveDefaultTransport(project: Project): ITransport {
  if (project.host.kind === 'local') return new LocalTransport()
  if (project.host.kind === 'wsl') return new WslTransport()
  if (project.host.kind === 'ssh') return new SshTransport()
  throw new Error(`Unknown host kind: ${(project.host as any).kind}`)
}
