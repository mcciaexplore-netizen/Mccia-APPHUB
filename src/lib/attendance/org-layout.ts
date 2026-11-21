/** The org chart's layout (OrgChart.tsx draws it). Pure, so it can be tested without a browser. */

export type OrgInput = { id: string; name: string; designation: string | null; managerId: string | null };
export const ORG_W = 180;
const W = ORG_W;
export const ORG_H = 56;
const H = ORG_H;
const GAP_X = 24;
const GAP_Y = 70;
export const ORG_ROOT = "__hr__";
const ROOT = ORG_ROOT;

type Placed = { id: string; name: string; designation: string | null; x: number; y: number; parent: string | null };

/** A tidy tree: each person centred over their reports; leaves side by side. HR is the root for anyone without a manager. */
export function layout(nodes: readonly OrgInput[]): { placed: Placed[]; width: number; height: number } {
  const kids = new Map<string, OrgInput[]>();
  for (const n of nodes) {
    const p = n.managerId ?? ROOT;
    kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const placed: Placed[] = [];
  const seen = new Set<string>();
  let nextX = 0;
  let maxDepth = 0;
  const visit = (id: string, name: string, designation: string | null, depth: number, parent: string | null): number => {
    seen.add(id);
    maxDepth = Math.max(maxDepth, depth);
    const children = (kids.get(id) ?? []).filter((c) => !seen.has(c.id));
    let x: number;
    if (!children.length) {
      x = nextX;
      nextX += W + GAP_X;
    } else {
      const xs = children.map((c) => visit(c.id, c.name, c.designation, depth + 1, id));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    placed.push({ id, name, designation, x, y: depth * (H + GAP_Y), parent });
    return x;
  };
  visit(ROOT, "HR", "Everyone without a manager", 0, null);
  // Anyone caught in a reporting loop (should not happen: the hub refuses loops) is still shown, under HR.
  for (const n of nodes) if (!seen.has(n.id)) visit(n.id, n.name, n.designation, 1, ROOT);
  return { placed, width: Math.max(nextX - GAP_X, W), height: (maxDepth + 1) * (H + GAP_Y) - GAP_Y };
}

