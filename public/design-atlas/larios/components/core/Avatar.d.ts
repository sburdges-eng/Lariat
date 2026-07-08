import React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Explicit initials; otherwise derived from name. */
  initials?: string;
  /** Full name — used for the title and initials fallback. */
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'amber' | 'ink';
}

/** Round initials chip (display grotesque on amber) — the cook / staff mark. */
export function Avatar(props: AvatarProps): JSX.Element;
