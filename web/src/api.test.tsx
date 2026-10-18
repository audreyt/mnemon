import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQuery } from "./api";

const response = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
interface Page {
  items: { id: string }[];
  next_cursor: string;
  total?: number;
}

describe("scope-safe live requests", () => {
  it("clears scope data and metadata immediately and rejects replies from aborted older scopes", async () => {
    const old = deferred<Response>();
    const next = deferred<Response>();
    const newest = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [{ id: "private-a" }],
          next_cursor: "secret-cursor",
          total: 123,
        }),
      )
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(newest.promise);
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(
      ({ url, token }) => useQuery<Page>(url, token),
      { initialProps: { url: "/a", token: 0 } },
    );
    await waitFor(() => expect(result.current.data?.total).toBe(123));
    rerender({ url: "/a", token: 1 });
    expect(result.current.data?.items[0].id).toBe("private-a");
    rerender({ url: "/b", token: 1 });
    expect(result.current.data).toBeUndefined();
    expect((fetcher.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(
      true,
    );
    rerender({ url: "/c", token: 1 });
    await act(async () => {
      old.resolve(response({ items: [{ id: "late-a" }], next_cursor: "" }));
      next.resolve(response({ items: [{ id: "late-b" }], next_cursor: "" }));
    });
    expect(result.current.data).toBeUndefined();
    await act(async () =>
      newest.resolve(
        response({ items: [{ id: "current-c" }], next_cursor: "" }),
      ),
    );
    expect(result.current.data?.items[0].id).toBe("current-c");
  });
  it("retains failed-refresh data only for the same query key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ items: [{ id: "saved" }], next_cursor: "" }),
        )
        .mockResolvedValueOnce(response({ error: "Store unavailable" }, 503))
        .mockResolvedValueOnce(response({ error: "No permission" }, 403)),
    );
    const { result, rerender } = renderHook(({ url }) => useQuery<Page>(url), {
      initialProps: { url: "/same" },
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.error?.message).toBe("Store unavailable"),
    );
    expect(result.current.data?.items[0].id).toBe("saved");
    rerender({ url: "/other" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() =>
      expect(result.current.error?.message).toBe("No permission"),
    );
    expect(result.current.data).toBeUndefined();
  });
  it.each(["manual", "visibility"])(
    "preserves pagination after a failed %s refresh",
    async (mode) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          response({ items: [{ id: "one" }], next_cursor: "retained-page" }),
        )
        .mockResolvedValueOnce(response({ error: "Temporary failure" }, 503))
        .mockResolvedValueOnce(
          response({ items: [{ id: "two" }], next_cursor: "" }),
        );
      vi.stubGlobal("fetch", fetcher);
      const { result } = renderHook(() => useQuery<Page>("/pages", 0, true));
      await waitFor(() =>
        expect(result.current.data?.next_cursor).toBe("retained-page"),
      );
      act(() => {
        if (mode === "manual") result.current.refresh();
        else document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() =>
        expect(result.current.error?.message).toBe("Temporary failure"),
      );
      expect(result.current.data?.next_cursor).toBe("retained-page");
      act(() => result.current.loadMore());
      await waitFor(() =>
        expect(result.current.data?.items).toEqual([
          { id: "one" },
          { id: "two" },
        ]),
      );
      expect(fetcher.mock.calls[2][0]).toBe("/pages?cursor=retained-page");
    },
  );
  it("removes previously loaded content when a memory becomes unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ items: [{ id: "now-deleted" }], next_cursor: "" }),
        )
        .mockResolvedValueOnce(response({ error: "Memory unavailable" }, 404)),
    );
    const { result } = renderHook(() => useQuery<Page>("/memory"));
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.error?.message).toBe("Memory unavailable"),
    );
    expect(result.current.data).toBeUndefined();
  });
  it("serializes pagination, aborts an in-flight page on manual refresh, and restarts cursors", async () => {
    const pendingPage = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ items: [{ id: "one" }], next_cursor: "first-cursor" }),
      )
      .mockReturnValueOnce(pendingPage.promise)
      .mockResolvedValueOnce(
        response({ items: [{ id: "fresh" }], next_cursor: "fresh-cursor" }),
      )
      .mockResolvedValueOnce(
        response({ items: [{ id: "two" }], next_cursor: "" }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useQuery<Page>("/list?limit=24", 0, true),
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("/list?limit=24&cursor=first-cursor");
    act(() => result.current.refresh());
    expect((fetcher.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(
      true,
    );
    await waitFor(() => expect(result.current.data?.items[0].id).toBe("fresh"));
    expect(fetcher.mock.calls[2][0]).toBe("/list?limit=24");
    await act(async () =>
      pendingPage.resolve(
        response({
          items: [{ id: "obsolete" }],
          next_cursor: "obsolete-cursor",
        }),
      ),
    );
    expect(result.current.data?.items).toEqual([{ id: "fresh" }]);
    act(() => result.current.loadMore());
    await waitFor(() =>
      expect(result.current.data?.items).toEqual([
        { id: "fresh" },
        { id: "two" },
      ]),
    );
    expect(fetcher.mock.calls[3][0]).toBe("/list?limit=24&cursor=fresh-cursor");
  });
  it("polls after completion without overlaps and pauses polling while hidden", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(response({ items: [], next_cursor: "" }));
    vi.stubGlobal("fetch", fetcher);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const { result, unmount } = renderHook(() => useQuery<Page>("/poll"));
    await act(async () => vi.advanceTimersByTimeAsync(45_000));
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve(response({ items: [], next_cursor: "" })),
    );
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.loading).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    visibility.mockRestore();
  });
});
