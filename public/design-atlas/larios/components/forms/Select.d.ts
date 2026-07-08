import React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  size?: 'md' | 'lg';
  invalid?: boolean;
}

/** Inset dropdown — matches Input styling. */
export function Select(props: SelectProps): JSX.Element;
