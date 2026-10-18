export interface Insight {
  id: string;
  content: string;
  category: string;
  importance: number;
  tags: string[];
  entities: string[];
  source: string;
  access_count: number;
  created_at: string;
  updated_at: string;
}
export interface Edge {
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  metadata: Record<string, string>;
  created_at: string;
}
export interface Meta {
  version: string;
  initial_store: string;
  categories: string[];
  edge_types: string[];
}
export interface Entity {
  name: string;
  count: number;
}
export interface Overview {
  total: number;
  edge_count: number;
  by_category: Record<string, number>;
  entities: Entity[];
  sources: string[];
  tags: string[];
  recent: Insight[];
  updated_at: string;
}
export interface MemoryPage {
  items: Insight[];
  total: number;
  next_cursor: string;
  truncated: boolean;
  updated_at: string;
}
export interface MemoryDetail {
  memory: Insight;
  related: Insight[];
  edges: Edge[];
  superseded_by: string[];
  replaces: string[];
  truncated: boolean;
  updated_at: string;
}
export interface GraphData {
  nodes: Insight[];
  edges: Edge[];
  total: number;
  truncated: boolean;
  updated_at: string;
}
export interface EntityPage {
  items: Entity[];
  total: number;
  next_cursor: string;
  updated_at: string;
}
export interface Activity {
  id: string;
  operation: string;
  insight_id: string;
  available: boolean;
  created_at: string;
}
export interface ActivityPage {
  items: Activity[];
  next_cursor: string;
  updated_at: string;
}
export type Page =
  | "overview"
  | "library"
  | "graph"
  | "entities"
  | "activity"
  | "memories"
  | "missing";
export interface Route {
  store: string;
  page: Page;
  id: string;
  search: string;
}
