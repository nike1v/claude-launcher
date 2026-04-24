import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { ITransport, SpawnOptions } from './transports/types'
import type { Project, StreamJsonEvent } from '../shared/types'
import { parseStreamJsonLine } from './stream-json-parser'
import { WslTransport } from './transports/wsl'
import { SshTransport } from './transports/ssh'

type EventCallback = (channel: string, payload: unknown) => void

interface ActiveSession {
  sessionId: string
  projectId: string
  process: ChildProcess
  lineBuffer: string
}

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
    const session: ActiveSession = { sessionId, projectId: project.id, process, lineBuffer: '' }
    this.sessions.set(sessionId, session)

    process.stdout?.on('data', (chunk: Buffer) => this.handleStdout(session, chunk))
    process.stderr?.on('data', (chunk: Buffer) => { stderrBuffer += chunk.toString('utf-8') })
    process.on('exit', (code) => {
      const isError = code !== 0 && code !== null
      const errorMessage = isError
        ? `Process exited with code ${code}${stderrBuffer.trim() ? `\n${stderrBuffer.trim()}` : ''}`
        : undefined
      this.onEvent('session:status', {
        sessionId,
        status: isError ? 'error' : 'closed',
        errorMessage
      })
      this.sessions.delete(sessionId)
    })

    return sessionId
  }

  public sendMessage(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const payload = JSON.stringify({ type: 'user', message: text }) + '\n'
    session.process.stdin?.write(payload)
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
    session.process.kill()
    this.sessions.delete(sessionId)
    this.onEvent('session:status', { sessionId, status: 'closed' })
  }

  public stopAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.stopSession(sessionId)
    }
  }

  private handleStdout(session: ActiveSession, chunk: Buffer): void {
    session.lineBuffer += chunk.toString('utf-8')
    const lines = session.lineBuffer.split('\n')
    session.lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const event: StreamJsonEvent | null = parseStreamJsonLine(line)
      if (!event) continue

      if (event.type === 'system' && event.subtype === 'init') {
        this.onEvent('session:status', { sessionId: session.sessionId, status: 'ready' })
      } else if (event.type === 'result') {
        this.onEvent('session:status', { sessionId: session.sessionId, status: 'ready' })
      } else if (event.type === 'assistant') {
        this.onEvent('session:status', { sessionId: session.sessionId, status: 'busy' })
      }

      this.onEvent('session:event', { sessionId: session.sessionId, event })
    }
  }
}

function resolveDefaultTransport(project: Project): ITransport {
  if (project.host.kind === 'wsl') return new WslTransport()
  if (project.host.kind === 'ssh') return new SshTransport()
  throw new Error(`Unknown host kind: ${(project.host as any).kind}`)
}
