import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** amber fill / matte / transparent / bone fill / oxblood / sage. */
  variant?: 'primary' | 'default' | 'ghost' | 'ink' | 'danger' | 'ok';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

/**
 * Compact uppercase action button — matte fill, 1px border that lights amber
 * on hover, depresses on press. The primary system action control.
 * @startingPoint section="Controls" subtitle="Buttons — primary, ghost, danger, sizes" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;
