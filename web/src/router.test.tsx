import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  filtersOnly,
  Link,
  parseRoute,
  routeURL,
  Router,
  useRouter,
} from "./router";

describe("workspace URLs", () => {
  it("round-trips store names, Unicode IDs, and all supported filters", () => {
    const search = new URLSearchParams({
      q: "中文 context",
      category: "fact",
      entity: "A/B",
      tag: "private",
      source: "cli",
      importance: "5",
      since: "2026-01-01",
      until: "2026-12-31",
      sort: "updated",
    }).toString();
    const url = new URL(
      routeURL("my space", "memories", search, "记忆/1"),
      "http://localhost",
    );
    expect(parseRoute(url.pathname, url.search)).toEqual({
      store: "my space",
      page: "memories",
      id: "记忆/1",
      search: `?${search}`,
    });
    expect(filtersOnly(`?${search}&cursor=old&focus=id`).toString()).toBe(
      search,
    );
  });
  it("rejects malformed and unrecognized routes", () => {
    for (const path of [
      "/s/store/unknown",
      "/s/store/library/extra",
      "/s/store/memories",
      "/s/%GG/overview",
      "/other",
    ])
      expect(parseRoute(path).page).toBe("missing");
  });
  it("responds to deep links, browser Back, and browser Forward while preserving filters", async () => {
    window.history.replaceState(null, "", "/s/alpha/library?q=hello");
    function Location() {
      const { route } = useRouter();
      return (
        <>
          <output>
            {route.store}:{route.page}:{route.id}:{route.search}
          </output>
          <Link href="/s/alpha/memories/first?q=hello">Read</Link>
        </>
      );
    }
    render(
      <Router>
        <Location />
      </Router>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "alpha:library::?q=hello",
    );
    fireEvent.click(screen.getByRole("link", { name: "Read" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "alpha:memories:first:?q=hello",
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "alpha:library::?q=hello",
      ),
    );
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "alpha:memories:first:?q=hello",
      ),
    );
  });
});
