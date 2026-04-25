import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import { ProjectItem } from './ProjectItem'

interface Props {
  label: string
  projects: Project[]
  activeProjectId: string | null
  onEdit: (project: Project) => void
}

export function ProjectGroup({ label, projects, activeProjectId, onEdit }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="mb-2">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-1 w-full px-3 py-1 text-xs font-medium text-white/40 hover:text-white/60 uppercase tracking-wider"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {label}
      </button>
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
