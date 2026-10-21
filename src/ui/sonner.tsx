import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      // sizes from the type scale (src/index.css), set inline: sonner's own CSS would win over a class
      toastOptions={{
        style: { fontSize: "var(--text-sm)", lineHeight: "var(--text-sm--line-height)" },
        actionButtonStyle: { fontSize: "var(--text-label)" },
        cancelButtonStyle: { fontSize: "var(--text-label)" },
      }}
      {...props}
    />
  )
}

export { Toaster }
