import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { useSlop } from '@slop-ai/tanstack-start'
import { slopMiddleware } from '../server/middleware'

const fetchProject = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => d)
  .handler(async ({ data: id }) => {
    const { setResponseHeaders } = await import('@tanstack/react-start/server')
    const { getProject, getTasksForProject } = await import('../server/state')
    setResponseHeaders({ 'Cache-Control': 'no-store' })
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
  const router = useRouter()
  const { project, tasks } = Route.useLoaderData()
  const [newTask, setNewTask] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)

  const addTask = async () => {
    const trimmedTask = newTask.trim()
    if (!trimmedTask) return
    await addTaskFn({ data: { projectId: project.id, title: trimmedTask } })
    await router.invalidate()
    setNewTask('')
  }

  const saveProjectName = async () => {
    await renameProjectFn({ data: { id: project.id, name: editName } })
    await router.invalidate()
    setEditing(false)
  }

  const toggleTask = async (taskId: string) => {
    await toggleTaskFn({ data: taskId })
    await router.invalidate()
  }

  const removeTask = async (taskId: string) => {
    await deleteTaskFn({ data: taskId })
    await router.invalidate()
  }

  useSlop('task_form', {
    type: 'view',
    props: { text: newTask },
    actions: {
      type: { params: { value: 'string' }, handler: (params: any) => setNewTask(params.value) },
      submit: async () => {
        await addTask()
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
        await saveProjectName()
      },
      cancel: () => setEditing(false),
    },
  })

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="btn-ghost mb-6 inline-block text-sm">
          &larr; Back to projects
        </Link>

        <div className="mb-8 flex items-center gap-3">
          {editing ? (
            <>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveProjectName()
                  if (e.key === 'Escape') setEditing(false)
                }}
                className="slop-input flex-1 px-4 py-2 text-xl font-bold"
                autoFocus
              />
              <button
                onClick={() => { void saveProjectName() }}
                className="btn-primary px-4 py-2 text-sm"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="btn-ghost px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h1 className="display-title text-2xl font-bold text-[var(--on-surface)]">{project.name}</h1>
              <button
                onClick={() => { setEditing(true); setEditName(project.name) }}
                className="btn-ghost rounded-[4px] px-3 py-1 text-xs transition hover:bg-[var(--surface-container)]"
              >
                Edit
              </button>
            </>
          )}
        </div>

        <div className="mb-8 flex gap-3">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTask()
            }}
            placeholder="Add a task..."
            className="slop-input flex-1 px-4 py-2.5 text-sm"
          />
          <button
            onClick={() => { void addTask() }}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            Add
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <div key={t.id} className="island-shell flex items-center gap-3 rounded-[4px] p-4">
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => { void toggleTask(t.id) }}
                className="h-4 w-4"
              />
              <span className={`flex-1 text-sm ${t.done ? 'text-[var(--on-surface-variant)] line-through opacity-50' : 'text-[var(--on-surface)]'}`}>
                {t.title}
              </span>
              <button
                onClick={() => { void removeTask(t.id) }}
                className="btn-ghost text-sm text-[var(--error)] hover:text-[var(--error)]"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        {tasks.length === 0 && (
          <p className="py-10 text-center text-[var(--on-surface-variant)]">No tasks yet. Add one above!</p>
        )}

        <p className="mt-10 text-center font-mono text-xs tracking-[0.05em] text-[var(--on-surface-variant)] opacity-40">
          {tasks.filter((t) => t.done).length}/{tasks.length} done · Project {project.id}
        </p>
      </div>
    </main>
  )
}
