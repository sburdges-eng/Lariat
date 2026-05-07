/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next 14.2 requires this flag for the `instrumentation.ts` hook to
    // run. Next 15+ enables it by default. Used by our mDNS auto-start
    // (`instrumentation.ts` → `lib/mdnsAdvertiseLifecycle.ts`).
    instrumentationHook: true,
    // @huggingface/transformers ships ONNX runtime + WASM assets that
    // webpack can't statically bundle. Marking it (and its onnxruntime
    // siblings) external lets Node resolve them at runtime via the
    // package's own loader. Required for `lib/datapackSearch.ts`'s
    // semantic-search path.
    serverComponentsExternalPackages: [
      'better-sqlite3',
      '@huggingface/transformers',
      'onnxruntime-node',
      'onnxruntime-web',
      // bonjour-service pulls in `multicast-dns` which uses `node:dgram`
      // and `node:os`. Webpack cannot bundle those for the edge runtime;
      // marking it external lets Node resolve it at runtime. Reached
      // transitively via the mDNS auto-start path
      // (`instrumentation.ts` → lifecycle → `lib/mdnsDiscovery.ts`).
      'bonjour-service',
    ],
  },
  webpack: (config, { isServer, nextRuntime, webpack }) => {
    // Instrumentation hook builds for both `nodejs` and `edge` runtimes.
    // Two leaf chains reach Node-only modules transitively:
    //   1. mDNS:    instrumentation.ts → lifecycle → mdnsDiscovery.ts
    //               → bonjour-service (uses node:dgram / node:os).
    //   2. Drainer: instrumentation.ts → cloudBridgeDrainerLifecycle.ts
    //               → cloudBridgeDrainer.ts → db.ts → better-sqlite3
    //               (uses node:path / node:fs via `bindings` +
    //               `file-uri-to-path`).
    //
    // - For the Node-server bundle: mark the npm packages external so
    //   webpack lets Node resolve them at runtime instead of trying to
    //   bundle native code.
    // - For the edge bundle: alias the same packages — plus the node
    //   built-ins `path` / `fs` reached via the drainer chain — to
    //   `false` so webpack replaces them with empty stubs. Both chains
    //   are gated behind a `NEXT_RUNTIME === 'nodejs'` check in
    //   `instrumentation.ts`, so the edge bundle never executes the
    //   stubs at runtime.
    const externalPackages = [
      'bonjour-service',
      'multicast-dns',
      'dns-packet',
      'better-sqlite3',
      'bindings',
      'file-uri-to-path',
    ];
    if (isServer && nextRuntime === 'nodejs') {
      config.externals = config.externals || [];
      config.externals.push(...externalPackages);
    } else if (nextRuntime === 'edge') {
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      for (const pkg of externalPackages) {
        config.resolve.alias[pkg] = false;
      }
      // Unprefixed Node built-ins reached transitively via
      // `lib/db.ts` (drainer chain → better-sqlite3 setup uses
      // `import path from 'path'`, `import fs from 'fs'`).
      config.resolve.alias['path'] = false;
      config.resolve.alias['fs'] = false;
      // `node:`-prefixed built-ins are URI-scheme requests, not
      // module-name requests — webpack throws `UnhandledSchemeError`
      // BEFORE alias/fallback resolution. The repo convention is
      // `import x from 'node:foo'` (see `lib/uuid.ts`,
      // `lib/idempotency.ts`, `lib/cloudBridgePush.ts`, etc.), so we
      // strip the entire scheme for the edge bundle. IgnorePlugin
      // treats matching requests as empty modules, identical to
      // `alias: false` for unprefixed names. The runtime guard in
      // `instrumentation.ts` ensures these stubs are never evaluated.
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^node:/ }),
      );
    }
    return config;
  },
};
export default nextConfig;
