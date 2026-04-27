import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import { ProjectItem } from './ProjectItem'

interface Props {
  label: string
  projects: Project[]
  activeProjectId: string | null
  onEdit: (project: Project) => void
  onAddProject?: () => void
}

export function ProjectGroup({ label, projects, activeProjectId, onEdit, onAddProject }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="mb-2 group/g">
      <div className="flex items-center w-full pr-2">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex-1 flex items-center gap-1 px-3 py-1 text-xs font-medium text-white/40 hover:text-white/60 uppercase tracking-wider min-w-0"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span className="truncate">{label}</span>
        </button>
        {onAddProject && (
          <button
            type="button"
            onClick={onAddProject}
            title="Add project to this environment"
            className="p-1 rounded text-white/30 hover:text-white hover:bg-white/5 opacity-0 group-hover/g:opacity-100 transition-opacity"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="pl-1">
          {projects.map(project => (
            <ProjectItem
              key={project.id}
              project={project}
              isActive={project.id === activeProjectId}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  )
}
