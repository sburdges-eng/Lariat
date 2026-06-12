// English catalog — the source of truth. Every other locale is typed
// against this object (see lib/i18n/index.ts), so adding/removing a key
// here is a typecheck-enforced change across all locales.
//
// Copy obeys docs/UI_COPY_RULES.md: kitchen-native, short, readable in
// under 2 seconds. tests/js/test-i18n-catalog.mjs runs the banned-word
// list against this file.

export const en = {
  shell: {
    brand: 'Lariat v2',
    returnV1: 'Return to v1',
    gateTitle: 'Preview is off',
    gateBody: 'The v2 cockpit is only available on devices carrying the preview flag.',
    localeLabel: 'Language',
  },
  common: {
    back: 'Back',
    next: 'Next',
    open: 'Open',
    watch: 'Watch',
    latest: 'Latest',
  },
  today: {
    eyebrow: 'Today · {date}',
    title: 'Line now',
    subhead: 'See what is ready, what is out, and where to jump next.',
    statReady: 'Ready',
    statFlagged: 'Flagged',
    stat86: '86 now',
    sendToLine: 'Send to line',
    eightySixNow: '86 right now',
    openLine: 'Open line',
    stations_one: '{n} station',
    stations_other: '{n} stations',
    stockMoves: 'Stock moves',
    noStockMoves: 'No stock moves yet',
    open_one: '{n} open',
    open_other: '{n} open',
    station: {
      noLineCheck: 'No line check',
      flagged_one: '{n} flagged',
      flagged_other: '{n} flagged',
      signedOff: 'Signed off',
      ready: 'Ready',
      progress: '{done} of {total}',
      openLine: 'Open line',
    },
  },
};
