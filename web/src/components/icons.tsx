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

export const ArchiveIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6" />
  </IconBase>
);

export const UniverseIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <ellipse cx="12" cy="12" rx="10" ry="4.5" />
    <ellipse cx="12" cy="12" rx="4.5" ry="10" transform="rotate(35 12 12)" />
  </IconBase>
);
