import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const MOCK_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'next-server-mock.mjs'),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return {
      url: MOCK_URL,
      format: 'module',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
