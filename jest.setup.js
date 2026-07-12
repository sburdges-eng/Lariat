// @ts-check
// Jest setup — extends expect(...) with DOM matchers like
// toBeInTheDocument, toHaveTextContent, toHaveAttribute.
// @ts-expect-error — jest-dom's type entry (types/index.d.ts) is a global
// augmentation script (triple-slash reference only, no top-level export), so
// it is "not a module" for a value `require`. The runtime side effect
// (expect.extend of the DOM matchers) is unaffected; this file stays CommonJS
// so the ESM side-effect `import` form (which typechecks) can't be used here.
require('@testing-library/jest-dom');
