import React from 'react';

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase micro-cap label above the control. */
  label?: React.ReactNode;
  /** Hint text below the control. */
  hint?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
}

/** Label + control wrapper — the standard stacked form row. */
export function Field(props: FieldProps): JSX.Element;
