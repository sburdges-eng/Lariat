// Types for the BOH ops packet sheets rendered at /boh.
//
// The packet is 12 kitchen sheets — day plans, prep pars, count sheets,
// station SOPs. On paper each is a letter page; on a phone each is a
// stack of blocks. These types describe that stack.
//
// Sheet data is generated from docs/boh/print/lariat-ops-packet.html by
// scripts/build-boh-sheets.mjs. See lib/boh/sheets.generated.ts.

/** Who can open the sheet. Manager sheets sit behind the PIN. */
export type BohTier = 'cook' | 'manager';

/**
 * Body text that may carry `**bold**` spans. The packet bolds the things
 * that burn you — "wet added right before service, never early" — so the
 * emphasis is load-bearing and survives into the app.
 */
export type RichText = string;

/** One tickable line: "A — Fryers ON, left two @350". */
export interface TaskRow {
  id: string;
  /** Station letter or role. Null on ordered SOP steps. */
  who: string | null;
  task: RichText;
}

/** A read-only fact about a count row, e.g. Pack "2/5LB", Par "4". */
export interface CountMeta {
  label: string;
  value: RichText;
}

/** A number the cook writes in, e.g. Have, Order, On hand, Make. */
export interface CountInput {
  key: string;
  label: string;
}

/** One line of a count or par sheet. */
export interface CountRow {
  id: string;
  label: RichText;
  meta: CountMeta[];
  /** Present only when the packet row carries a tick box. */
  checkable: boolean;
}

/** A cell in a reference grid. */
export type GridCell =
  /** Printed text, not writable. */
  | { kind: 'text'; text: RichText }
  /** Text with a tick box, e.g. "Boil out both fryers ☐". */
  | { kind: 'check'; id: string; text: RichText }
  /**
   * Blank in the packet — becomes a writable box. `hint` carries printed
   * text that belongs beside the box rather than in it, e.g. the "/3" on
   * the weekly score grid.
   */
  | { kind: 'entry'; id: string; hint?: RichText };

export interface GridRow {
  id: string;
  cells: GridCell[];
}

/** A labelled blank in a sheet header, e.g. "Date ____", "Mgr ____". */
export type FieldPart =
  | { kind: 'static'; text: RichText }
  | { kind: 'field'; id: string; label: string };

export type BohBlock =
  | { kind: 'heading'; level: 2 | 3; text: RichText }
  | { kind: 'note'; text: RichText }
  /** The emphasised rules box — the gate conditions, the never-do lines. */
  | { kind: 'callout'; text: RichText }
  /** Header line of a sheet, split into static chips and writable blanks. */
  | { kind: 'fields'; parts: FieldPart[] }
  | { kind: 'tasks'; ordered: boolean; rows: TaskRow[] }
  | { kind: 'count'; inputs: CountInput[]; rows: CountRow[] }
  | { kind: 'grid'; columns: RichText[]; rows: GridRow[] };

export interface BohSheet {
  slug: string;
  title: string;
  /** One line on the hub tile saying what the sheet is for. */
  blurb: string;
  tier: BohTier;
  blocks: BohBlock[];
}

/** Every block kind that holds writable or tickable state. */
export const INTERACTIVE_BLOCK_KINDS = ['fields', 'tasks', 'count', 'grid'] as const;
