import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const DashboardIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </IconBase>
);

export const MemoryIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9 4.5a3 3 0 0 0-5 2.2 3 3 0 0 0 .8 2A3.5 3.5 0 0 0 6 15.4V17a3 3 0 0 0 3 3Z" />
    <path d="M15 4.5a3 3 0 0 1 5 2.2 3 3 0 0 1-.8 2 3.5 3.5 0 0 1-1.2 6.7V17a3 3 0 0 1-3 3Z" />
    <path d="M9 7h2m4 0h-2M9 12h2m4 0h-2" />
  </IconBase>
);

export const DiaryIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5Z" />
    <path d="M5 4.5v17M9 7h7m-7 4h5" />
  </IconBase>
);

export const TaskIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m4 7 2 2 4-4M12 7h8M4 14l2 2 4-4m2 2h8" />
  </IconBase>
);

export const SearchIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </IconBase>
);

export const ArchiveIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6" />
  </IconBase>
);

export const PenIcon = (props: IconProps) => (
  <IconBase {...props}>
    <g transform="translate(24 0) scale(-1 1)">
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </g>
  </IconBase>
);

export const CalendarIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
    <path d="M7.5 3v5M16.5 3v5M3.5 10h17" />
  </IconBase>
);

export const MoodIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9 10h.01M15 10h.01M9.5 15h5" />
  </IconBase>
);

export const StatusIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
  </IconBase>
);

export const UniverseIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <ellipse cx="12" cy="12" rx="10" ry="4.5" />
    <ellipse
      cx="12"
      cy="12"
      rx="4.5"
      ry="10"
      transform="rotate(35 12 12)"
    />
  </IconBase>
);

export const SettingsIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
  </IconBase>
);
