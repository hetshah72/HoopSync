// Stub for the `server-only` package in tests. The real package throws
// unconditionally unless resolved under Next.js's "react-server" export
// condition, which Vitest's plain Node/Vite resolution doesn't set. Since
// tests intentionally exercise server-side code directly (not through a
// Client Component), the guard itself has nothing to check here.
export {};
