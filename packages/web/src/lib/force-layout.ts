export interface ForceLayoutNodeInput {
  id: string;
  label: string;
  featureCount?: number;
}

export interface ForceLayoutEdgeInput {
  from: string;
  to: string;
  label: string;
}

export interface ForceLayoutNode extends ForceLayoutNodeInput {
  x: number;
  y: number;
  radius: number;
}

export interface ForceLayoutEdge extends ForceLayoutEdgeInput {
  source: ForceLayoutNode;
  target: ForceLayoutNode;
}

export interface ForceLayoutResult {
  width: number;
  height: number;
  nodes: ForceLayoutNode[];
  edges: ForceLayoutEdge[];
}

const LAYOUT_WIDTH = 960;
const LAYOUT_HEIGHT = 560;
const MIN_RADIUS = 24;
const MAX_RADIUS = 44;
const ITERATIONS = 100;

export function countFeatures(features: string): number {
  return features
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export function layoutNavigationGraph(input: {
  nodes: ForceLayoutNodeInput[];
  edges: ForceLayoutEdgeInput[];
}): ForceLayoutResult {
  if (input.nodes.length === 0) {
    return {
      width: LAYOUT_WIDTH,
      height: LAYOUT_HEIGHT,
      nodes: [],
      edges: [],
    };
  }

  const nodes = createInitialNodes(input.nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = input.edges.flatMap((edge): ForceLayoutEdge[] => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);

    if (!source || !target) {
      return [];
    }

    return [{ ...edge, source, target }];
  });

  simulate(nodes, edges);

  return {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
    nodes,
    edges,
  };
}

function createInitialNodes(inputs: ForceLayoutNodeInput[]): ForceLayoutNode[] {
  const centerX = LAYOUT_WIDTH / 2;
  const centerY = LAYOUT_HEIGHT / 2;
  const orbitRadius = Math.min(LAYOUT_WIDTH, LAYOUT_HEIGHT) * 0.32;

  return inputs.map((input, index) => {
    const angle = inputs.length === 1 ? 0 : (Math.PI * 2 * index) / inputs.length - Math.PI / 2;
    const x = inputs.length === 1 ? centerX : centerX + Math.cos(angle) * orbitRadius;
    const y = inputs.length === 1 ? centerY : centerY + Math.sin(angle) * orbitRadius;
    const radius = radiusForFeatureCount(input.featureCount ?? 0);

    return {
      ...input,
      x: clamp(roundLayoutValue(x), radius, LAYOUT_WIDTH - radius),
      y: clamp(roundLayoutValue(y), radius, LAYOUT_HEIGHT - radius),
      radius,
    };
  });
}

function simulate(nodes: ForceLayoutNode[], edges: ForceLayoutEdge[]): void {
  const velocities = nodes.map(() => ({ x: 0, y: 0 }));
  const indexByNode = new Map(nodes.map((node, index) => [node, index]));

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const velocity = velocities[i];

      if (!node || !velocity) {
        continue;
      }

      for (let j = i + 1; j < nodes.length; j += 1) {
        const other = nodes[j];
        const otherVelocity = velocities[j];

        if (!other || !otherVelocity) {
          continue;
        }

        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 0.01);
        const distance = Math.sqrt(distanceSquared);
        const force = 2800 / distanceSquared;
        const forceX = (dx / distance) * force;
        const forceY = (dy / distance) * force;

        velocity.x += forceX;
        velocity.y += forceY;
        otherVelocity.x -= forceX;
        otherVelocity.y -= forceY;
      }
    }

    for (const edge of edges) {
      if (edge.source === edge.target) {
        continue;
      }

      const sourceIndex = indexByNode.get(edge.source);
      const targetIndex = indexByNode.get(edge.target);

      if (sourceIndex === undefined || targetIndex === undefined) {
        continue;
      }

      const sourceVelocity = velocities[sourceIndex];
      const targetVelocity = velocities[targetIndex];

      if (!sourceVelocity || !targetVelocity) {
        continue;
      }

      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const desiredDistance = 170 + edge.source.radius + edge.target.radius;
      const force = (distance - desiredDistance) * 0.01;
      const forceX = (dx / distance) * force;
      const forceY = (dy / distance) * force;

      sourceVelocity.x += forceX;
      sourceVelocity.y += forceY;
      targetVelocity.x -= forceX;
      targetVelocity.y -= forceY;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const velocity = velocities[i];

      if (!node || !velocity) {
        continue;
      }

      velocity.x += (LAYOUT_WIDTH / 2 - node.x) * 0.006;
      velocity.y += (LAYOUT_HEIGHT / 2 - node.y) * 0.006;
      velocity.x *= 0.82;
      velocity.y *= 0.82;

      node.x = clamp(roundLayoutValue(node.x + velocity.x), node.radius, LAYOUT_WIDTH - node.radius);
      node.y = clamp(roundLayoutValue(node.y + velocity.y), node.radius, LAYOUT_HEIGHT - node.radius);
    }
  }
}

function radiusForFeatureCount(featureCount: number): number {
  const safeCount = Number.isFinite(featureCount) ? Math.max(0, featureCount) : 0;

  return clamp(MIN_RADIUS + Math.round(safeCount * 1.7), MIN_RADIUS, MAX_RADIUS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundLayoutValue(value: number): number {
  return Math.round(value * 100) / 100;
}
