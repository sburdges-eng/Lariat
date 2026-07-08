import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Inset multi-line field — matches Input; vertical resize only. */
export function Textarea(props: TextareaProps): JSX.Element;
