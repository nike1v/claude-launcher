import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Project } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'
import { useSessionsStore } from '../../store/sessions'
import { ProjectGroup } from './ProjectGroup'
import { HistoryList } from './HistoryList'
import { AddProjectModal } from './AddProjectModal'
import { UpdatePill } from './UpdatePill'

function groupByHost(projects: ReturnType<typeof useProjectsStore.getState>['projects']) {
  const groups = new Map<string, typeof projects>()
  for (const project of projects) {
    const label = project.host.kind === 'wsl'
      ? `WSL: ${project.host.distro}`
      : `SSH: ${project.host.host}`
    const existing = groups.get(label) ?? []
    groups.set(label, [...existing, project])
  }
  return groups
}

export function Sidebar(): JSX.Element {
  const { projects, activeProjectId } = useProjectsStore()
  const { sessions, activeSessionId } = useSessionsStore()
  const [showAdd, setShowAdd] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)

  const activeProject = activeSessionId
    ? projects.find(p => p.id === sessions[activeSessionId]?.projectId)
    : undefined

  const groups = groupByHost(projects)

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
        {Array.from(groups.entries()).map(([label, groupProjects]) => (
          <ProjectGroup
            key={label}
            label={label}
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
