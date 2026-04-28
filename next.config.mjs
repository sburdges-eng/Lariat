/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
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
    ],
  }
};
export default nextConfig;
