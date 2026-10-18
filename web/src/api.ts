import { useCallback, useEffect, useRef, useState } from "react";

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function fetchJSON<T>(
  url: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new APIError(
      body?.error || `Request failed (${response.status})`,
      response.status,
    );
  if (!body) throw new Error("The server returned an unreadable response.");
  return body as T;
}
interface QueryState<T> {
  key: string;
  data?: T;
  error?: Error;
  loading: boolean;
  loadingMore: boolean;
}
interface Paged {
  items?: unknown[];
  next_cursor?: string;
}

// Each query owns one request and one timer. A new scope never exposes the previous scope's data.
export function useQuery<T>(
  url: string | null,
  refreshToken = 0,
  paginate = false,
) {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<QueryState<T>>({
    key: "",
    loading: true,
    loadingMore: false,
  });
  const more = useRef<() => void>(() => {});
  const retainedCursor = useRef({ key: "", value: "" });
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let busy = false;
    let cursor =
      retainedCursor.current.key === url ? retainedCursor.current.value : "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && document.visibilityState !== "hidden")
        timer = setTimeout(() => void run(), 15_000);
    };
    const run = async (append = false) => {
      if (disposed || busy) return;
      busy = true;
      clearTimeout(timer);
      controller = new AbortController();
      setState((previous) => ({
        key: url,
        data: previous.key === url ? previous.data : undefined,
        loading: !append,
        loadingMore: append,
      }));
      const endpoint =
        append && cursor
          ? `${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
          : url;
      try {
        const data = await fetchJSON<T>(endpoint, controller.signal);
        if (disposed) return;
        cursor = (data as Paged).next_cursor || "";
        retainedCursor.current = { key: url, value: cursor };
        setState((previous) => {
          let result = data;
          if (paginate && append && previous.key === url && previous.data) {
            result = {
              ...data,
              items: [
                ...((previous.data as Paged).items || []),
                ...((data as Paged).items || []),
              ],
            };
          }
          return { key: url, data: result, loading: false, loadingMore: false };
        });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        if (
          error instanceof APIError &&
          [401, 403, 404, 410].includes(error.status)
        ) {
          cursor = "";
          retainedCursor.current = { key: url, value: "" };
        }
        setState((previous) => ({
          ...previous,
          key: url,
          data:
            error instanceof APIError &&
            [401, 403, 404, 410].includes(error.status)
              ? undefined
              : previous.data,
          loading: false,
          loadingMore: false,
          error:
            error instanceof Error
              ? error
              : new Error("Unable to load this workspace."),
        }));
      } finally {
        if (!disposed) {
          busy = false;
          schedule();
        }
      }
    };
    more.current = () => {
      if (cursor) void run(true);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void run();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      more.current = () => {};
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, refreshToken, generation, paginate]);
  const scoped =
    state.key === url
      ? state
      : { key: url || "", loading: !!url, loadingMore: false };
  return { ...scoped, refresh, loadMore: () => more.current() };
}
export type Query<T> = ReturnType<typeof useQuery<T>>;
export function storeAPI(
  store: string,
  endpoint: string,
  params?: URLSearchParams,
) {
  return `/api/stores/${encodeURIComponent(store)}/${endpoint}${params?.size ? `?${params}` : ""}`;
}
