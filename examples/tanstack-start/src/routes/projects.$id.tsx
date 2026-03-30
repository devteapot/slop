import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { useSlop } from '@slop-ai/tanstack-start'
import { slopMiddleware } from '../server/middleware'

const fetchProject = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const { getProject, getTasksForProject } = await import('../server/state')
    const project = getProject(id)
    if (!project) throw new Error('Project not found')
    return { project, tasks: getTasksForProject(id) }
  })

const addTaskFn = createServerFn({ method: 'POST' })
  .middleware([slopMiddleware])
  .inputValidator((d: { projectId: string; title: string }) => d)
  .handler(async ({ data }) => {
    const { addTask } = await import('../server/state')
    addTask(data.projectId, data.title)
  })

const toggleTaskFn = createServerFn({ method: 'POST' })
  .middleware([slopMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const { toggleTask } = await import('../server/state')
    toggleTask(id)
  })

const deleteTaskFn = createServerFn({ method: 'POST' })
  .middleware([slopMiddleware])
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const { deleteTask } = await import('../server/state')
    deleteTask(id)
  })

const renameProjectFn = createServerFn({ method: 'POST' })
  .middleware([slopMiddleware])
  .inputValidator((d: { id: string; name: string }) => d)
  .handler(async ({ data }) => {
    const { renameProject } = await import('../server/state')
    renameProject(data.id, data.name)
  })

export const Route = createFileRoute('/projects/$id')({
  loader: ({ params }) => fetchProject({ data: params.id }),
  component: ProjectDetailPage,
})

function ProjectDetailPage() {
  const { project, tasks } = Route.useLoaderData()
  const [newTask, setNewTask] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)

  useSlop('task_form', {
    type: 'view',
    props: { text: newTask },
    actions: {
      type: { params: { value: 'string' }, handler: (params: any) => setNewTask(params.value) },
      submit: async () => {
        if (newTask.trim()) {
          await addTaskFn({ data: { projectId: project.id, title: newTask } })
          setNewTask('')
        }
      },
      clear: () => setNewTask(''),
    },
  })

  useSlop('edit_mode', {
    type: 'status',
    props: { editing, name: editName },
    actions: {
      start_edit: () => { setEditing(true); setEditName(project.name) },
      type_name: { params: { value: 'string' }, handler: (params: any) => setEditName(params.value) },
      save: async () => {
        await renameProjectFn({ data: { id: project.id, name: editName } })
        setEditing(false)
      },
      cancel: () => setEditing(false),
    },
  })

  const handleAddTask = async () => {
    if (!newTask.trim()) return
    await addTaskFn({ data: { projectId: project.id, title: newTask } })
    setNewTask('')
  }

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="mb-4 inline-block text-sm text-[var(--sea-ink-soft)]">
          ← Back to projects
        </Link>

        <div className="mb-6 flex items-center gap-3">
          {editing ? (
            <>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { renameProjectFn({ data: { id: project.id, name: editName } }); setEditing(false) }
                  if (e.key === 'Escape') setEditing(false)
                }}
                className="island-shell flex-1 rounded-xl px-4 py-2 text-xl font-bold outline-none"
                autoFocus
              />
              <button
                onClick={() => { renameProjectFn({ data: { id: project.id, name: editName } }); setEditing(false) }}
                className="rounded-xl bg-[rgba(79,184,178,0.24)] px-4 py-2 text-sm font-semibold text-[var(--lagoon-deep)]"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-xl px-4 py-2 text-sm text-[var(--sea-ink-soft)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-[var(--sea-ink)]">{project.name}</h1>
              <button
                onClick={() => { setEditing(true); setEditName(project.name) }}
                className="rounded-lg px-3 py-1 text-xs text-[var(--sea-ink-soft)] transition hover:bg-[rgba(79,184,178,0.08)]"
              >
                Edit
              </button>
            </>
          )}
        </div>

        <div className="mb-6 flex gap-2">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
            placeholder="Add a task..."
            className="island-shell flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={handleAddTask}
            className="rounded-xl bg-[rgba(79,184,178,0.24)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.36)]"
          >
            Add
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <div key={t.id} className="island-shell flex items-center gap-3 rounded-xl p-3">
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => toggleTaskFn({ data: t.id })}
                className="h-4 w-4 accent-[rgb(79,184,178)]"
              />
              <span className={`flex-1 text-sm ${t.done ? 'text-[var(--sea-ink-soft)] line-through' : 'text-[var(--sea-ink)]'}`}>
                {t.title}
              </span>
              <button
                onClick={() => deleteTaskFn({ data: t.id })}
                className="text-red-400 text-sm hover:text-red-300"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {tasks.length === 0 && (
          <p className="py-10 text-center text-[var(--sea-ink-soft)]">No tasks yet. Add one above!</p>
        )}

        <p className="mt-8 text-center text-xs text-[var(--sea-ink-soft)] opacity-50">
          {tasks.filter((t) => t.done).length}/{tasks.length} done · Project {project.id}
        </p>
      </div>
    </main>
  )
}
