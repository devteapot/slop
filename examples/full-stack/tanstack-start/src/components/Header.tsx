import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 bg-[var(--surface-container-low)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-4 py-3 sm:py-4">
        <div className="flex items-center gap-x-4 text-sm font-semibold">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Home
          </Link>
          <Link
            to="/about"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            About
          </Link>
        </div>
      </nav>
    </header>
  )
}
