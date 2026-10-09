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

export const DiaryIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5Z" />
    <path d="M5 4.5v17M9 7h7m-7 4h5" />
  </IconBase>
);

export const ConversationIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 5.5h11a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9l-4 3v-3H4a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z" />
    <path d="M9 9h5M9 12h3" />
    <path d="M18 8.5h1a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-1v2l-3-2" />
  </IconBase>
);

export const SearchIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </IconBase>
);

export const PlusIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 5v14M5 12h14" />
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


export const ScopeIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="4" y="6" width="14" height="13" rx="2.5" />
    <path d="M7 3h10a3 3 0 0 1 3 3v10" />
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


export const AccountIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </IconBase>
);

export const ConnectionsIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M7.5 16.5 6 18a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" />
    <path d="m16.5 7.5 1.5-1.5a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" />
  </IconBase>
);

export const DataIcon = (props: IconProps) => (
  <IconBase {...props}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
    <path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
  </IconBase>
);

export const AboutIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 10.5V17M12 7h.01" />
  </IconBase>
);
