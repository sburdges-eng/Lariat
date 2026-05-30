import fs from 'node:fs/promises';
import path from 'node:path';

export async function GET() {
  for (const name of ['icon.png', 'icon-192.png']) {
    try {
      const bytes = await fs.readFile(path.join(process.cwd(), 'public', name));
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
        },
      });
    } catch {
      /* try next icon */
    }
  }

  return new Response(null, { status: 404 });
}
