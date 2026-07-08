import React from 'react';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** neutral / ok (sage) / warn (brass) / alert (oxblood) / amber / ink / lari. */
  tone?: 'neutral' | 'ok' | 'warn' | 'alert' | 'amber' | 'ink' | 'lari';
  /** Show a leading status dot. */
  dot?: boolean;
}

/** Small uppercase status capsule, tinted by tone. Ready / Low / Out / 86'd. */
export function Pill(props: PillProps): JSX.Element;
