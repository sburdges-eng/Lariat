// Shared constants for the specials surface (app/specials/page.jsx and
// app/api/specials/route.js). PURE DATA — this module must have zero imports
// (especially nothing node:-prefixed) because the specials page is a
// 'use client' component and this file is pulled into the client bundle.

export const MAX_MESSAGE = 2000;

export const AI_DOWN_COPY =
  "AI is down. Can't connect to Ollama on the office Mac. Ask a manager to start it.";
