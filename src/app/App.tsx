import { Redirect, Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { isSetUp } from '@/backend/client'
import { Toaster } from '@/ui/sonner'
import { TooltipProvider } from '@/ui/tooltip'
import { myTeamKeys } from '@/data/select'
import { useData } from '@/data/store'
import { HelpPage } from '@/features/help/HelpPage'
import { InboxPage } from '@/features/inbox/InboxPage'
import { IssuePage } from '@/features/issues/IssuePage'
import { MyIssuesPage } from '@/features/issues/MyIssuesPage'
import { ProjectPage } from '@/features/projects/ProjectPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { TeamIssuesPage } from '@/features/teams/TeamIssuesPage'
import { ViewPage } from '@/features/views/ViewPage'
import { ViewsPage } from '@/features/views/ViewsPage'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { WhatsNewPage } from '@/features/whatsnew/WhatsNewPage'
import { Gate } from './Gate'
import { NotFound } from './NotFound'
import { NotSetUp } from './NotSetUp'
import { Shell } from './Shell'

function Home() {
  // the first of your teams as the sidebar lists them
  const first = useData((s) => myTeamKeys(s)[0])
  return <Redirect to={first ? `/team/${first}/issues/active` : '/my-issues'} replace />
}

/** Hash routes (#/team/ENG/issues/active) because GitHub Pages serves one static file. */
export function App() {
  if (!isSetUp()) return <NotSetUp />
  return (
    <TooltipProvider delayDuration={300}>
      <Router hook={useHashLocation}>
        <Gate>
          <Shell>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/inbox" component={InboxPage} />
            <Route path="/my-issues" component={MyIssuesPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/project/:id" component={ProjectPage} />
            <Route path="/views" component={ViewsPage} />
            <Route path="/view/:id" component={ViewPage} />
            <Route path="/team/:key/issues/:tab?" component={TeamIssuesPage} />
            <Route path="/team/:key/projects" component={ProjectsPage} />
            <Route path="/team/:key/views" component={ViewsPage} />
            <Route path="/issue/:ref" component={IssuePage} />
            <Route path="/help" component={HelpPage} />
            <Route path="/whats-new" component={WhatsNewPage} />
            <Route path="/settings" component={SettingsScreen} />
            <Route path="/settings/*" component={SettingsScreen} />
            <Route component={NotFound} />
          </Switch>
          </Shell>
        </Gate>
      </Router>
      <Toaster position="bottom-right" theme="dark" />
    </TooltipProvider>
  )
}
