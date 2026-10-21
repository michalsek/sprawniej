/** Pick an emoji (teams, views, projects). A button showing the current emoji opens a searchable grid. */
import { useState } from 'react'
import { EmojiPicker as Picker } from 'frimousse'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { cn } from '@/lib/utils'

export function EmojiPicker({ value, onChange, label = 'Choose an emoji', className }: { value: string; onChange: (emoji: string) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border text-emoji-lg hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
        aria-label={label}
      >
        {value}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Picker.Root
          className="isolate flex h-80 w-fit flex-col"
          columns={9}
          onEmojiSelect={({ emoji }) => {
            onChange(emoji)
            setOpen(false)
          }}
        >
          <Picker.Search className="z-10 mx-2 mt-2 h-9 appearance-none rounded-md border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" placeholder="Search emoji" />
          <Picker.Viewport className="relative flex-1 outline-hidden">
            <Picker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading…</Picker.Loading>
            <Picker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No emoji found</Picker.Empty>
            <Picker.List
              className="select-none pb-1.5"
              components={{
                CategoryHeader: ({ category, ...props }) => (
                  <div className="bg-popover px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground" {...props}>
                    {category.label}
                  </div>
                ),
                Row: ({ children, ...props }) => (
                  <div className="scroll-my-1.5 px-1.5" {...props}>
                    {children}
                  </div>
                ),
                Emoji: ({ emoji, ...props }) => (
                  <button className="flex size-8 items-center justify-center rounded-md text-emoji data-[active]:bg-accent" {...props}>
                    {emoji.emoji}
                  </button>
                ),
              }}
            />
          </Picker.Viewport>
        </Picker.Root>
      </PopoverContent>
    </Popover>
  )
}
