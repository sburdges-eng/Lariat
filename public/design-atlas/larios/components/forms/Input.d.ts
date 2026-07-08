import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  size?: 'md' | 'lg';
  /** Oxblood border to flag an invalid value. */
  invalid?: boolean;
}

/** Inset text field — recessed app-bg fill, hairline that lights amber on focus. */
export function Input(props: InputProps): JSX.Element;
