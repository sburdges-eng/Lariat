import React from 'react';

export interface TabItem {
  value: string;
  label: React.ReactNode;
}

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  tabs: TabItem[];
  /** Controlled active value. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}

/** Mono uppercase tab strip on a hairline; active tab gets an amber underline. */
export function Tabs(props: TabsProps): JSX.Element;
