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
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--sea-ink)]">Projects</h1>
          <div className="flex gap-2">
            {(['all', 'active', 'archived'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  filter === f
                    ? 'bg-[rgba(79,184,178,0.24)] text-[var(--lagoon-deep)]'
                    : 'text-[var(--sea-ink-soft)] hover:bg-[rgba(79,184,178,0.08)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New project name..."
            className="island-shell flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={handleCreate}
            className="rounded-xl bg-[rgba(79,184,178,0.24)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.36)]"
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
              className="island-shell flex items-center justify-between rounded-xl p-4 no-underline transition hover:shadow-md"
            >
              <div>
                <div className="font-semibold text-[var(--sea-ink)]">{p.name}</div>
                <div className="text-sm text-[var(--sea-ink-soft)]">
                  {p.taskCount} tasks · {p.doneCount} done
                  {p.status === 'archived' && (
                    <span className="ml-2 opacity-50">archived</span>
                  )}
                </div>
              </div>
              <span className="text-[var(--sea-ink-soft)]">→</span>
            </Link>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="py-10 text-center text-[var(--sea-ink-soft)]">
            No {filter === 'all' ? '' : filter} projects.
          </p>
        )}

        <p className="mt-8 text-center text-xs text-[var(--sea-ink-soft)] opacity-50">
          {projects.length} projects · SLOP data at /slop · UI mounted under /ui
        </p>
      </div>
    </main>
  )
}
