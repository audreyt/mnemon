import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GraphView } from "./GraphView";
import { Router } from "./router";
import type { Insight, Meta } from "./types";

vi.mock("cytoscape", () => ({
  default: () => ({
    on: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    nodes: () => ({ unselect: vi.fn() }),
    getElementById: () => ({ select: vi.fn() }),
    fit: vi.fn(),
    zoom: vi.fn(() => 1),
    width: () => 500,
    height: () => 500,
    layout: () => ({ run: vi.fn() }),
  }),
}));
const memory: Insight = {
  id: "m1",
  content: "A connected thought",
  category: "fact",
  importance: 4,
  tags: [],
  entities: ["Project"],
  source: "literal-source",
  access_count: 0,
  created_at: "",
  updated_at: "",
};
const meta: Meta = {
  version: "test",
  initial_store: "alpha",
  categories: ["fact"],
  edge_types: ["semantic", "supersedes"],
};

it("supports keyboard-equivalent graph selection, reader links, URL focus, and Back restoration", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.history.replaceState(null, "", "/s/alpha/graph");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        nodes: [memory],
        edges: [
          {
            source_id: "m1",
            target_id: "m1",
            edge_type: "supersedes",
            weight: 0.8,
            metadata: { reason: "correction" },
          },
        ],
        total: 1,
        truncated: false,
        updated_at: "",
      }),
    })),
  );
  render(
    <Router>
      <GraphView meta={meta} refresh={0} />
    </Router>,
  );
  const node = await screen.findByRole("button", {
    name: /A connected thought/,
  });
  fireEvent.click(node);
  expect(node).toHaveAttribute("aria-pressed", "true");
  expect(new URLSearchParams(window.location.search).get("selected")).toBe(
    "m1",
  );
  expect(screen.getByText("literal-source")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Read full memory" }),
  ).toHaveAttribute("href", "/s/alpha/memories/m1?selected=m1");
  fireEvent.click(screen.getByRole("button", { name: "Expand neighborhood" }));
  expect(new URLSearchParams(window.location.search).get("focus")).toBe("m1");
  await screen.findByRole("button", { name: "Clear neighborhood focus" });
  expect(
    screen.getByText(/Weight 0.8 · reason: correction/),
  ).toBeInTheDocument();
  for (const label of [
    "Zoom in",
    "Zoom out",
    "Fit graph",
    "Reset graph layout",
  ])
    expect(screen.getByRole("button", { name: label })).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Close selected memory" }),
  );
  expect(screen.queryByRole("link", { name: "Read full memory" })).toBeNull();
  await act(async () => {
    window.history.back();
  });
  await screen.findByRole("link", { name: "Read full memory" });
});
