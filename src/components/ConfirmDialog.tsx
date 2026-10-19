/** "Are you sure?" for the few things that can't be undone with a click (deleting). */
import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  confirm: string
  onConfirm: () => void
  keep?: string
  /** for the biggest deletes: the button only works once this (a team's name) is typed */
  typeToConfirm?: string
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function ConfirmDialog({ open, onOpenChange, title, children, confirm, onConfirm, keep = 'Keep it', typeToConfirm }: Props) {
  const [typed, setTyped] = useState('')
  const id = useId()
  const ready = typeToConfirm === undefined || same(typed, typeToConfirm)
  const change = (o: boolean) => {
    if (!o) setTyped('')
    onOpenChange(o)
  }
  const go = () => {
    if (!ready) return
    onConfirm()
    change(false)
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="[overflow-wrap:anywhere]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2">{children}</div>
        </DialogDescription>
        {typeToConfirm !== undefined && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              go()
            }}
          >
            <label htmlFor={id} className="text-sm">
              Type <span className="font-semibold">{typeToConfirm}</span> to confirm
            </label>
            <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>
            {keep}
          </Button>
          <Button variant="destructive" disabled={!ready} onClick={go}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
