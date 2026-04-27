import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import { ProjectItem } from './ProjectItem'
import { useDragReorder } from '../../hooks/useDragReorder'
import { useProjectsStore } from '../../store/projects'

interface Props {
  label: string
  // groupKey scopes drag-reorder to this environment so a project drag
  // can't cross into a different env's bucket.
  groupKey: string
  projects: Project[]
  activeProjectId: string | null
  onEdit: (project: Project) => void
  onAddProject?: () => void
}

export function ProjectGroup({ label, groupKey, projects, activeProjectId, onEdit, onAddProject }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const reorderProjects = useProjectsStore(s => s.reorderProjects)
  const dnd = useDragReorder({
    onReorder: reorderProjects
  })

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
          {projects.map(project => {
            const dropping = dnd.isDropTarget(project.id)
            const above = dropping && dnd.dropPosition === 'before'
            const below = dropping && dnd.dropPosition === 'after'
            return (
              <div
                key={project.id}
                {...dnd.bindRow(project.id, groupKey)}
                className={`relative ${dnd.isDragging(project.id) ? 'opacity-40' : ''}`}
              >
                {above && <DropLine edge="top" />}
                <ProjectItem
                  project={project}
                  isActive={project.id === activeProjectId}
                  onEdit={onEdit}
                />
                {below && <DropLine edge="bottom" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Thin blue insertion line shown above/below the row a drop is targeting.
function DropLine({ edge }: { edge: 'top' | 'bottom' }): JSX.Element {
  return (
    <div
      className={`absolute inset-x-1 h-0.5 bg-blue-400/80 rounded-full pointer-events-none ${
        edge === 'top' ? 'top-0' : 'bottom-0'
      }`}
    />
  )
}
