import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Archivo small-caps header title. */
  title?: React.ReactNode;
  /** Right-aligned header slot (pill, button, meta). */
  right?: React.ReactNode;
  /** Add elevation — for floating context (menus/modals) ONLY. */
  floating?: boolean;
  /** Body padding. Default true; false for edge-to-edge tables. */
  padded?: boolean;
  children?: React.ReactNode;
}

/**
 * Matte panel with a 1px hairline and optional small-caps header. Depth is the
 * border, not a shadow (shadows are reserved for floating context).
 * @startingPoint section="Surfaces" subtitle="Panel / card with header" viewport="700x150"
 */
export function Card(props: CardProps): JSX.Element;
