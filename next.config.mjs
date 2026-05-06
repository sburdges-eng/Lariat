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
  webpack: (config, { isServer, nextRuntime }) => {
    // Instrumentation hook builds for both `nodejs` and `edge` runtimes.
    // `bonjour-service` (and its `multicast-dns` / `dns-packet` deps) use
    // `node:dgram` / `node:os`, which only exist in Node.
    //
    // - For the Node-server bundle: mark them external so webpack lets
    //   Node resolve them at runtime instead of trying to bundle native
    //   networking modules.
    // - For the edge bundle: alias to `false` so webpack replaces them
    //   with empty stubs. The mDNS code path is gated behind a
    //   `NEXT_RUNTIME === 'nodejs'` check in `instrumentation.ts`, so
    //   the edge bundle never actually executes those stubs.
    const externalPackages = ['bonjour-service', 'multicast-dns', 'dns-packet'];
    if (isServer && nextRuntime === 'nodejs') {
      config.externals = config.externals || [];
      config.externals.push(...externalPackages);
    } else if (nextRuntime === 'edge') {
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      for (const pkg of externalPackages) {
        config.resolve.alias[pkg] = false;
      }
    }
    return config;
  },
};
export default nextConfig;
