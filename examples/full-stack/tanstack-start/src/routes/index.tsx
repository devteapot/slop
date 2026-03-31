import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { useSlop } from '@slop-ai/tanstack-start'
import { slopMiddleware } from '../server/middleware'

const fetchProjects = createServerFn({ method: 'GET' }).handler(async () => {
  const { getProjects, getTasksForProject } = await import('../server/state')
  return {
    projects: getProjects().map((p) => ({
      ...p,
      taskCount: getTasksForProject(p.id).length,
      doneCount: getTasksForProject(p.id).filter((t) => t.done).length,
    })),
  }
})

const createProjectFn = createServerFn({ method: 'POST' })
  .middleware([slopMiddleware])
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const { addProject } = await import('../server/state')
    addProject(data.name)
  })

export const Route = createFileRoute('/')({
  loader: () => fetchProjects(),
  component: ProjectsPage,
})

function ProjectsPage() {
  const { projects } = Route.useLoaderData()
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all')
  const [newName, setNewName] = useState('')

  useSlop('filters', {
    type: 'status',
    props: { status: filter },
    actions: {
      set_filter: {
        params: { status: 'string' },
        handler: (params: any) => setFilter(params.status),
      },
    },
  })

  useSlop('create_form', {
    type: 'view',
    props: { name: newName },
    actions: {
      type: {
        params: { value: 'string' },
        handler: (params: any) => setNewName(params.value),
      },
      submit: async () => {
        if (newName.trim()) {
          await createProjectFn({ data: { name: newName } })
          setNewName('')
        }
      },
      clear: () => setNewName(''),
    },
  })

  const filtered = projects.filter((p) => filter === 'all' || p.status === filter)

  const handleCreate = async () => {
    if (!newName.trim()) return
    await createProjectFn({ data: { name: newName } })
    setNewName('')
  }

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="display-title text-2xl font-bold text-[var(--on-surface)]">Projects</h1>
          <div className="flex gap-2">
            {(['all', 'active', 'archived'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`filter-chip px-4 py-1.5 transition ${
                  filter === f
                    ? 'filter-chip--active'
                    : 'filter-chip--inactive'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8 flex gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New project name..."
            className="slop-input flex-1 px-4 py-2.5 text-sm"
          />
          <button
            onClick={handleCreate}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            Create
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to="/projects/$id"
              params={{ id: p.id }}
              className="island-shell flex items-center justify-between rounded-[4px] p-5 no-underline"
            >
              <div>
                <div className="font-semibold text-[var(--on-surface)]">{p.name}</div>
                <div className="mt-1 font-mono text-xs tracking-[0.05em] text-[var(--on-surface-variant)]">
                  {p.taskCount} tasks · {p.doneCount} done
                  {p.status === 'archived' && (
                    <span className="ml-2 text-[var(--secondary)] opacity-60">ARCHIVED</span>
                  )}
                </div>
              </div>
              <span className="text-[var(--on-surface-variant)]">&rarr;</span>
            </Link>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="py-10 text-center text-[var(--on-surface-variant)]">
            No {filter === 'all' ? '' : filter} projects.
          </p>
        )}

        <p className="mt-10 text-center font-mono text-xs tracking-[0.05em] text-[var(--on-surface-variant)] opacity-40">
          {projects.length} projects · SLOP data at /slop · UI mounted under /ui
        </p>
      </div>
    </main>
  )
}
