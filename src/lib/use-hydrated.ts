import { useSyncExternalStore } from "react";

// A store that never changes, so `subscribe` has nothing to do. Defined at
// module scope because useSyncExternalStore re-subscribes whenever the
// `subscribe` identity changes.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * `false` during server render and the hydration pass, `true` afterwards.
 *
 * The usual `useState(false)` + `useEffect(() => setMounted(true))` does the
 * same job, but it sets state synchronously inside an effect - which React
 * Compiler's lint rules reject, because it schedules a second render pass for
 * every component that does it.
 *
 * `useSyncExternalStore` expresses the same idea declaratively: React is told
 * the server snapshot differs from the client one, so it re-renders once after
 * hydration without a manual state write.
 *
 * Use it to gate anything that can only be known in the browser (the resolved
 * colour theme, `localStorage`, viewport size) and always render a same-size
 * placeholder in the `false` branch so nothing shifts when the real value
 * arrives.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
