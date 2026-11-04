import * as React from "react";

// For requests where only the newest answer counts: searches, filters and "load more".
// start() aborts the previous request and returns the signal for the next one; the caller
// ignores its result once that signal is aborted. abort() cancels the current one, and
// unmounting does too.
export function useLatestRequest() {
  const controller = React.useRef(null);
  const abort = React.useCallback(() => controller.current?.abort(), []);
  const start = React.useCallback(() => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  }, []);
  React.useEffect(() => abort, [abort]);
  return React.useMemo(() => ({ start, abort }), [start, abort]);
}
