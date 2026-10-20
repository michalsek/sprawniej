/**
 * Settings: the frame around every settings page (pages.tsx). It works out what the address opens (nav.ts), then
 * shows the page with its heading, a page that moved, "only admins and owners", or "couldn't find".
 */
import { Link, Redirect, useLocation } from 'wouter'
import { SearchX } from 'lucide-react'
import { useCrumbs } from '@/app/chrome'
import { EmptyState } from '@/components/EmptyState'
import { isAdmin } from '@/data/select'
import { useData } from '@/data/store'
import { Button } from '@/ui/button'
import { resolveSettings } from './nav'
import { PAGES, type SettingsPage } from './pages'

/** where "Back to Settings" goes from a page you can't use (the import's error step goes there too) */
const GENERAL = PAGES.find((p) => p.id === 'general')?.path ?? '/settings'

function AdminsOnly({ page }: { page: SettingsPage }) {
  const words = page.who === 'admins' ? page.forMembers : { title: 'open this page', text: '' }
  return (
    <EmptyState
      icon={<page.icon />}
      title={`Only admins and owners can ${words.title}`}
      action={
        <Button asChild variant="outline">
          <Link href={GENERAL}>Back to Settings</Link>
        </Button>
      }
    >
      {words.text}
    </EmptyState>
  )
}

function Missing() {
  return (
    <EmptyState
      icon={<SearchX />}
      title="We couldn't find this settings page"
      action={
        <Button asChild variant="outline">
          <Link href="/settings">Go to Settings</Link>
        </Button>
      }
    >
      It may have moved, or the link has a typo.
    </EmptyState>
  )
}

export function SettingsScreen() {
  const [location] = useLocation()
  const admin = useData(isAdmin)
  const found = resolveSettings(location, PAGES, admin)
  const title = 'page' in found ? found.page.title : undefined
  useCrumbs(title ? [{ label: 'Settings', href: '/settings' }, { label: title }] : [{ label: 'Settings' }])

  if ('to' in found) return <Redirect to={found.to} replace />
  if ('missing' in found) return <Missing />
  const { page, allowed } = found
  if (!allowed) return <AdminsOnly page={page} />
  if (page.ownLayout) return <page.component key={page.id} admin={admin} />
  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8">
      <div className="mx-auto max-w-3xl py-8">
        <h1 className="text-2xl font-semibold">{page.title}</h1>
        {page.description && <p className="mt-1 text-[15px] text-muted-foreground">{page.description}</p>}
        <div className="mt-8">
          <page.component key={page.id} admin={admin} />
        </div>
      </div>
    </div>
  )
}
