import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Environment, Project } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { useSessionsStore } from '../../store/sessions'
import { ProjectGroup } from './ProjectGroup'
import { HistoryList } from './HistoryList'
import { AddProjectModal } from './AddProjectModal'
import { UpdatePill } from './UpdatePill'

export function Sidebar(): JSX.Element {
  const { projects } = useProjectsStore()
  const { environments } = useEnvironmentsStore()
  const { sessions, activeSessionId } = useSessionsStore()
  const [showAdd, setShowAdd] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)

  const activeProject = activeSessionId
    ? projects.find(p => p.id === sessions[activeSessionId]?.projectId)
    : undefined

  const groups = useMemo(() => groupByEnvironment(projects, environments), [projects, environments])

  return (
    <div className="flex flex-col h-full pt-3">
      <div className="px-3 mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Projects</span>
        <button
          onClick={() => setShowAdd(true)}
          className="text-white/40 hover:text-white/80 p-0.5"
          title="Add project"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {groups.map(({ env, projects: groupProjects }) => (
          <ProjectGroup
            key={env.id}
            label={environmentLabel(env)}
            projects={groupProjects}
            activeProjectId={activeProject?.id ?? null}
            onEdit={setEditProject}
          />
        ))}

        {projects.length === 0 && (
          <p className="px-3 text-xs text-white/30">No projects yet. Click + to add one.</p>
        )}

        <HistoryList />
      </div>

      <UpdatePill />

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} />}
      {editProject && (
        <AddProjectModal editProject={editProject} onClose={() => setEditProject(null)} />
      )}
    </div>
  )
}

function groupByEnvironment(projects: Project[], envs: Environment[]) {
  const byId = new Map<string, { env: Environment; projects: Project[] }>()
  for (const env of envs) byId.set(env.id, { env, projects: [] })
  for (const project of projects) {
    const bucket = byId.get(project.environmentId)
    if (bucket) bucket.projects.push(project)
  }
  return Array.from(byId.values()).filter(g => g.projects.length > 0)
}

function environmentLabel(env: Environment): string {
  if (env.name) return env.name
  if (env.config.kind === 'local') return 'Local'
  if (env.config.kind === 'wsl') return `WSL: ${env.config.distro}`
  return `SSH: ${env.config.host}`
}
