/**
 * ⋯ next to a team (in the sidebar and Settings › Teams): edit its emoji and name (they save as you change them),
 * leave it, or delete it. Deleting takes the team's issues with it, so it says what goes and asks for the team's
 * name first.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { LogOut, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { backend } from '@/backend'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmojiPicker } from '@/components/EmojiPicker'
import { InlineText } from '@/components/InlineText'
import { deleteTeam, leaveTeam, teamContents, updateTeam } from '@/data/actions'
import { MESSAGES } from '@/backend/writes/problems'
import { isAdmin } from '@/data/select'
import { useData } from '@/data/store'
import { isSettingsPath } from '@/features/settings/nav'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu'

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function TeamMenu({ teamKey, className }: { teamKey: string; className?: string }) {
  const team = useData((s) => s.teams[teamKey])
  const admin = useData(isAdmin)
  const [location, navigate] = useLocation()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // archived issues may not be read yet: the database counts them
  const [archived, setArchived] = useState<number | null>(null)
  useEffect(() => {
    if (!deleting) return
    let stop = false
    void backend.countArchived(teamKey).then((n) => !stop && setArchived(n))
    return () => {
      stop = true
    }
  }, [deleting, teamKey])
  if (!team) return null

  const leave = () => {
    leaveTeam(team.key)
    toast(`You left ${team.emoji} ${team.name}`, { description: 'Join again any time with + next to Your teams.' })
  }
  const contents = deleting ? teamContents(team.key) : null
  const archivedCount = Math.max(archived ?? 0, contents?.archived ?? 0)
  // only what there is: "3 issues and 2 comments", not "0 views"
  const goes = contents
    ? [
        contents.issues && count(contents.issues, 'issue', 'issues'),
        archivedCount && count(archivedCount, 'archived issue', 'archived issues'),
        contents.comments && count(contents.comments, 'comment', 'comments'),
        contents.views && count(contents.views, 'view', 'views'),
      ].filter((x): x is string => !!x)
    : []

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${team.name}`} className={className}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        {/* focus goes to the dialog next, not back to this button */}
        <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Edit team
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={leave}>
            <LogOut /> Leave team
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {admin ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              <Trash2 /> Delete team
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled className="items-start">
              <Trash2 className="mt-0.5" />
              <span>
                Delete team
                <span className="block text-xs text-muted-foreground">{MESSAGES.deleteTeam}</span>
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Edit team</DialogTitle>
          <DialogDescription>Changes save by themselves.</DialogDescription>
          <div className="flex items-center gap-3">
            <EmojiPicker value={team.emoji} onChange={(emoji) => updateTeam(team.key, { emoji })} label={`Change the emoji of ${team.name}`} className="size-10 text-emoji-lg" />
            <div className="min-w-0 flex-1 rounded-md border px-3 py-2">
              <InlineText value={team.name} onSave={(name) => updateTeam(team.key, { name })} label="Team name" required className="text-field font-medium" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Issues are numbered {team.key}-1, {team.key}-2… The key stays the same, so links to issues keep working.
          </p>
          <DialogFooter className="sm:items-center sm:justify-between">
            {admin ? (
              <Button
                variant="ghost"
                className="text-destructive-text"
                onClick={() => {
                  setEditing(false)
                  setDeleting(true)
                }}
              >
                <Trash2 /> Delete team
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{MESSAGES.deleteTeam}</p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setEditing(false)
                leave()
              }}
            >
              <LogOut /> Leave team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${team.emoji} ${team.name}?`}
        confirm="Delete team"
        typeToConfirm={team.name}
        onConfirm={() => {
          const name = `${team.emoji} ${team.name}`
          // only admins and owners may: anyone else is told so
          if (!deleteTeam(team.key)) return
          // from Settings › Teams you stay on the list; anywhere else the team's pages are gone
          if (!isSettingsPath(location)) navigate('/', { replace: true })
          toast(`Deleted ${name}`)
        }}
      >
        <span>
          {goes.length
            ? `This deletes the team for everyone, with everything in it: ${goes.slice(0, -1).join(', ')}${goes.length > 1 ? ' and ' : ''}${goes.at(-1)}.`
            : 'This deletes the team for everyone. It has no issues yet.'}{' '}
          It can't be undone.
        </span>
        <span>Projects stay, without this team. To stop seeing the team yourself, leave it instead.</span>
      </ConfirmDialog>
    </>
  )
}
