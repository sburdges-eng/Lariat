// STATUS: machine-draft — operator review required before this locale
// ships to devices (docs/OPERATIONS_HANDOFF.md §5). Kitchen Spanish:
// BOH vocabulary stays BOH ("86" stays "86", "línea", "prep", "par").
//
// Typed against the English catalog — a missing or extra key fails
// `npm run typecheck`.

import type { Messages } from '../index.ts';

export const es: Messages = {
  shell: {
    brand: 'Lariat v2',
    returnV1: 'Volver a v1',
    gateTitle: 'Vista previa apagada',
    gateBody: 'El cockpit v2 solo está disponible en equipos con la bandera de vista previa.',
    localeLabel: 'Idioma',
  },
  common: {
    back: 'Atrás',
    next: 'Siguiente',
    open: 'Abrir',
    watch: 'Ver',
    latest: 'Lo último',
  },
  today: {
    eyebrow: 'Hoy · {date}',
    title: 'La línea ahora',
    subhead: 'Mira qué está listo, qué está en 86 y a dónde ir.',
    statReady: 'Listo',
    statFlagged: 'Marcado',
    stat86: '86 ahora',
    sendToLine: 'Mandar a la línea',
    eightySixNow: '86 ahora mismo',
    openLine: 'Línea abierta',
    stations_one: '{n} estación',
    stations_other: '{n} estaciones',
    stockMoves: 'Movimientos de stock',
    noStockMoves: 'Aún no hay movimientos',
    open_one: '{n} abierto',
    open_other: '{n} abiertos',
    station: {
      noLineCheck: 'Sin line check',
      flagged_one: '{n} marcado',
      flagged_other: '{n} marcados',
      signedOff: 'Firmado',
      ready: 'Listo',
      progress: '{done} de {total}',
      openLine: 'Línea abierta',
    },
  },
};
