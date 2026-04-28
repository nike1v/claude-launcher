import { Settings as SettingsIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Environment, Project } from '../../../../shared/types'
import { describeHost } from '../../../../shared/host-utils'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { useSessionsStore } from '../../store/sessions'
import { ProjectGroup } from './ProjectGroup'
import { AddProjectModal } from './AddProjectModal'
import { UpdatePill } from './UpdatePill'
import { SettingsModal } from '../Settings/SettingsModal'

export function Sidebar(): JSX.Element {
  const projects = useProjectsStore(s => s.projects)
  const environments = useEnvironmentsStore(s => s.environments)
  // Per-field selectors so the sidebar doesn't redraw on every chat event
  // landing in `sessions[id].hasUnread` / `.status` — only the active
  // pointer matters here, plus a single lookup of its projectId.
  const activeSessionId = useSessionsStore(s => s.activeSessionId)
  const activeProjectId = useSessionsStore(
    s => (s.activeSessionId ? s.sessions[s.activeSessionId]?.projectId ?? null : null)
  )
  const [showSettings, setShowSettings] = useState(false)
  const [addToEnv, setAddToEnv] = useState<string | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)

  const groups = useMemo(() => groupByEnvironment(projects, environments), [projects, environments])

  return (
    <div className="flex flex-col h-full pt-3">
      <div className="px-3 mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Projects</span>
        <button
          onClick={() => setShowSettings(true)}
          className="text-white/40 hover:text-white/80 p-0.5"
          title="Settings"
        >
          <SettingsIcon size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {groups.map(({ env, projects: groupProjects }) => (
          <ProjectGroup
            key={env.id}
            groupKey={env.id}
            label={environmentLabel(env)}
            projects={groupProjects}
            activeProjectId={activeProjectId}
            onEdit={setEditProject}
            onAddProject={() => setAddToEnv(env.id)}
          />
        ))}

        {environments.length === 0 && (
          <p className="px-3 text-xs text-white/30">
            No environments yet. Click the gear icon to add one.
          </p>
        )}
        {environments.length > 0 && projects.length === 0 && (
          <p className="px-3 text-xs text-white/30">
            No projects yet. Hover an environment and click + to add one.
          </p>
        )}
      </div>

      <UpdatePill />

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {addToEnv && (
        <AddProjectModal
          presetEnvironmentId={addToEnv}
          onClose={() => setAddToEnv(null)}
        />
      )}
      {editProject && (
        <AddProjectModal editProject={editProject} onClose={() => setEditProject(null)} />
      )}
    </div>
  )
}

function groupByEnvironment(projects: Project[], envs: Environment[]) {
  // Show every environment, even with zero projects, so a freshly added
  // environment appears immediately and the user can hover its row to add
  // its first project.
  const byId = new Map<string, { env: Environment; projects: Project[] }>()
  for (const env of envs) byId.set(env.id, { env, projects: [] })
  for (const project of projects) {
    const bucket = byId.get(project.environmentId)
    if (bucket) bucket.projects.push(project)
  }
  return Array.from(byId.values())
}

function environmentLabel(env: Environment): string {
  return env.name || describeHost(env.config)
}
