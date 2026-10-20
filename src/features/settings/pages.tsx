/**
 * The one list of settings pages. The routes, the settings menu, ⌘K, the crumbs and the "only admins and owners"
 * screen all follow it; the rules it goes by are in nav.ts (tests/settingsPages.test.ts checks them).
 *
 * To add a page:
 * 1. Write it in pages/YourPage.tsx. It gets `{ admin }` and draws no heading, crumbs or scroll (the frame does);
 *    use Section for its parts.
 * 2. Add an entry below, where it should show in the menu: id, group, a path under /settings/account/… or
 *    /settings/workspace/…, title, icon, who, component, and if you like description and words. A page with
 *    who: 'admins' needs forMembers (what a member who opens it reads); tsc asks for it.
 * 3. Add it to the list under "### Settings" in docs/user-guide.md, and describe it where it belongs there, as
 *    "Settings › Title".
 * A new group goes in GROUPS in nav.ts.
 */
import type { ComponentType } from 'react'
// one icon a line, so pages added side by side don't change the same line
import {
  Archive,
  CircleUser,
  Contact,
  Download,
  GitPullRequest,
  Group,
  KeyRound,
  NotebookText,
  Settings,
  Tags,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ImportPage } from '@/features/import/ImportPage'
import { GitHubSettings } from './GitHubSettings'
import { LabelsSettings } from './LabelsSettings'
import { Members } from './Members'
import { NotionSettings } from './NotionSettings'
import type { PageMeta } from './nav'
import { ArchivePage } from './pages/ArchivePage'
import { GeneralPage } from './pages/GeneralPage'
import { InvitesPage } from './pages/InvitesPage'
import { LinearPeoplePage } from './pages/LinearPeoplePage'
import { ProfilePage } from './pages/ProfilePage'
import { TeamsPage } from './pages/TeamsPage'
import { SignInWays } from './SignInWays'
import { hasUnlinked } from './unlinked'

export type SettingsPage = PageMeta & {
  icon: LucideIcon
  component: ComponentType<{ admin: boolean }>
}

/** in menu order; Settings itself opens the first one you may see */
export const PAGES: SettingsPage[] = [
  {
    id: 'profile',
    group: 'account',
    path: '/settings/account',
    title: 'Profile',
    icon: CircleUser,
    who: 'everyone',
    component: ProfilePage,
    words: 'account name handle mention picture avatar sign out switch workspace appearance theme light dark mode colours colors',
  },
  {
    id: 'sign-in',
    group: 'account',
    path: '/settings/account/sign-in',
    title: 'Ways to sign in',
    description: 'Use any of these to sign in to Sprawniej.',
    icon: KeyRound,
    who: 'everyone',
    component: SignInWays,
    words: 'account password email github google',
  },
  {
    id: 'general',
    group: 'workspace',
    path: '/settings/workspace',
    title: 'General',
    icon: Settings,
    who: 'everyone',
    component: GeneralPage,
    words: 'workspace name rename leave',
  },
  {
    id: 'members',
    group: 'workspace',
    path: '/settings/workspace/members',
    title: 'Members',
    description:
      'Everyone here can see and change every issue in the workspace. Owners and admins invite people, change roles, rename the workspace and delete teams. Only owners can make or change owners.',
    icon: Users,
    who: 'everyone',
    component: Members,
    words: 'people roles admin owner remove',
  },
  {
    id: 'invites',
    group: 'workspace',
    path: '/settings/workspace/invites',
    title: 'Invite links',
    description: 'A link works for as long as you choose, for one person or several. Whoever opens it can create an account and join. You can end a link at any time.',
    icon: UserPlus,
    who: 'admins',
    forMembers: { title: 'invite people', text: 'Ask one of them for an invite link.' },
    component: InvitesPage,
    words: 'invite people join',
  },
  {
    id: 'linear-people',
    group: 'workspace',
    path: '/settings/workspace/linear-people',
    title: 'People from Linear',
    icon: Contact,
    who: 'everyone',
    listed: hasUnlinked,
    component: LinearPeoplePage,
    words: 'invite link import',
  },
  {
    id: 'teams',
    group: 'workspace',
    path: '/settings/workspace/teams',
    title: 'Teams',
    description: 'Each team has its own issues, projects and views. Join the ones you work with.',
    icon: Group,
    who: 'everyone',
    component: TeamsPage,
    words: 'join create leave delete',
  },
  {
    id: 'labels',
    group: 'workspace',
    path: '/settings/workspace/labels',
    title: 'Labels',
    description: 'Labels sort issues across teams. Renaming or recolouring one changes it on every issue.',
    icon: Tags,
    who: 'everyone',
    component: LabelsSettings,
  },
  {
    id: 'archive',
    group: 'workspace',
    path: '/settings/workspace/archive',
    title: 'Archive',
    description:
      "Finished issues leave the lists some time after they're done, so the lists stay short and the app stays quick. Archived issues can still be opened, found and brought back.",
    icon: Archive,
    who: 'everyone',
    component: ArchivePage,
    words: 'finished done months',
  },
  {
    id: 'github',
    group: 'workspace',
    path: '/settings/workspace/github',
    title: 'GitHub',
    description:
      "Pull requests that mention an issue, like ENG-12 in the branch name, the title or the description, move it: to In Review when the pull request opens or is ready for review, and to Done when it's merged.",
    icon: GitPullRequest,
    who: 'everyone',
    component: GitHubSettings,
    words: 'pull request repository',
  },
  {
    id: 'notion',
    group: 'workspace',
    path: '/settings/workspace/notion',
    title: 'Notion',
    description: 'A button or an automation in Notion sends a page here, and it becomes an issue.',
    icon: NotebookText,
    who: 'everyone',
    component: NotionSettings,
    words: 'pages send webhook database button automation',
  },
  {
    id: 'import',
    group: 'workspace',
    path: '/settings/workspace/import',
    title: 'Import from Linear',
    icon: Download,
    who: 'admins',
    forMembers: { title: 'import', text: "Ask one of them to bring your team's work over from Linear." },
    oldPaths: ['/settings/import'],
    ownLayout: true,
    component: ImportPage,
    words: 'linear',
  },
]
