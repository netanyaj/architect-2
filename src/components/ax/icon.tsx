import type { ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

/* Inline stroke icons at 1.7px on a 20px grid, taken from the final screens. 18px in nav, 15px in controls. */
const paths = {
  home: <><path d="M3.5 9 10 3.5 16.5 9v7.5h-13z" /><path d="M8 16.5v-4h4v4" /></>,
  projects: <><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M3 8h14" /></>,
  agent: <><rect x="4" y="6" width="12" height="9" rx="3" /><path d="M10 3v3M7.5 10.5h.1M12.5 10.5h.1" /></>,
  connections: <path d="M8 12l4-4M7 9 5.5 10.5a2.5 2.5 0 0 0 3.5 3.5L10.5 12.5M13 11l1.5-1.5a2.5 2.5 0 0 0-3.5-3.5L9.5 7.5" />,
  marketplace: <><path d="M4 7h12l-1 9.5H5z" /><path d="M7.5 7a2.5 2.5 0 0 1 5 0" /></>,
  usage: <path d="M4 16V10M10 16V4M16 16v-6" />,
  approvals: <><path d="M10 3 4 5.5v4c0 4 2.6 6.5 6 7.5 3.4-1 6-3.5 6-7.5v-4z" /><path d="M7.5 10l2 2 3-3.5" /></>,
  governance: <><rect x="3.5" y="3.5" width="13" height="13" rx="2.5" /><path d="M7 8h6M7 12h4" /></>,
  help: <><circle cx="10" cy="10" r="7.5" /><path d="M8 8a2 2 0 1 1 2.6 1.9c-.4.1-.6.4-.6.8v.6M10 13.6v.1" /></>,
  switcher: <path d="M7 8l3-3 3 3M7 12l3 3 3-3" />,
  file: <><path d="M6 3h6l3 3v11H6z" /><path d="M12 3v3h3" /></>,
  doc: <><path d="M6 3h6l3 3v11H6z" /><path d="M8.5 10h4M8.5 13h4" /></>,
  close: <path d="M6 6l8 8M14 6l-8 8" />,
  plus: <path d="M10 4v12M4 10h12" />,
  repo: <><circle cx="6" cy="5" r="1.8" /><circle cx="6" cy="15" r="1.8" /><circle cx="14" cy="15" r="1.8" /><path d="M6 6.8v6.4M14 13.2V9a3 3 0 0 0-3-3H9" /></>,
  branch: <><circle cx="6" cy="5" r="1.8" /><circle cx="6" cy="15" r="1.8" /><path d="M6 6.8v6.4" /></>,
  grid: <><rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" /><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" /><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" /><rect x="11" y="11" width="5.5" height="5.5" rx="1.2" /></>,
  sparkle: <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M5.2 14.8l1.4-1.4M13.4 6.6l1.4-1.4" />,
  talk: <path d="M4 5h2M4 10h2M4 15h2M9 5h7M9 10h7M9 15h5" />,
  chevronDown: <path d="M6 8l4 4 4-4" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
  chevronLeft: <path d="M12 5l-5 5 5 5" />,
  mic: <><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 10a5 5 0 0 0 10 0M10 15v2" /></>,
  arrowUp: <path d="M10 15V5M6 9l4-4 4 4" />,
  arrowRight: <path d="M5 10h10M11 6l4 4-4 4" />,
  calendar: <><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 2.5v3M13 2.5v3" /></>,
  window: <><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14" /></>,
  lines: <path d="M4 5h12M4 10h12M4 15h7" />,
  chat: <path d="M4 5h12v8H9l-4 3v-3H4z" />,
  search: <><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></>,
  more: <><circle cx="5" cy="10" r="1.1" /><circle cx="10" cy="10" r="1.1" /><circle cx="15" cy="10" r="1.1" /></>,
  credits: <><circle cx="10" cy="10" r="7" /><path d="M10 6v8M12.5 7.5c-.5-.7-1.4-1-2.5-1-1.4 0-2.5.7-2.5 1.7 0 2.5 5 1.3 5 3.8 0 1-1.1 1.8-2.5 1.8-1.2 0-2.1-.4-2.6-1.1" /></>,
  panelRight: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M12 4v12" /></>,
  panelLeft: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M8 4v12" /></>,
  check: <path d="M5 10.5l3 3 7-7" />,
  warning: <><path d="M10 3.5l7 12.5H3z" /><path d="M10 8.5v3.5M10 14v.1" /></>,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>,
  checkCircle: <><circle cx="10" cy="10" r="7" /><path d="M6.5 10.5l2.5 2.5 4.5-5" /></>,
  play: <path d="M6 4l10 6-10 6z" />,
  lock: <><rect x="5" y="9" width="10" height="7" rx="1.5" /><path d="M7.5 9V7a2.5 2.5 0 0 1 5 0v2" /></>,
  external: <path d="M8 4H4v12h12v-4M11 4h5v5M16 4l-7 7" />,
  desktop: <><rect x="2.5" y="4" width="15" height="10" rx="1.5" /><path d="M7 17h6" /></>,
  phone: <rect x="6.5" y="3" width="7" height="14" rx="1.5" />,
  pointer: <path d="M5 3l10 6-4.5 1.2L9 15z" />,
  copy: <><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" /></>,
  download: <path d="M10 4v9M6 9l4 4 4-4M4 16h12" />,
  image: <><rect x="3" y="4" width="14" height="12" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="M4 15l4-4 3 3 2-2 3 3" /></>,
  code: <path d="M7 7l-3 3 3 3M13 7l3 3-3 3" />,
  pause: <path d="M8 6v8M12 6v8" />,
  minus: <path d="M5 10h10" />,
  fit: <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />,
  person: <><circle cx="10" cy="7" r="3" /><path d="M4 17c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5" /></>,
  newProject: <><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M3 8h14M10 10.5v3.5M8.2 12.2h3.6" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = "md",
  className,
  ...rest
}: { name: IconName; size?: "sm" | "md" } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn(
        "flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]",
        size === "sm" ? "size-[15px]" : "size-[18px]",
        className,
      )}
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
