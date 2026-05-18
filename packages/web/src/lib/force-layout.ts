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

const MIN_LAYOUT_WIDTH = 600;
const MIN_LAYOUT_HEIGHT = 400;
const MAX_LAYOUT_WIDTH = 1600;
const MAX_LAYOUT_HEIGHT = 1200;
const MIN_RADIUS = 24;
const MAX_RADIUS = 44;
const ITERATIONS = 100;

export function countFeatures(features: string): number {
  if (features.includes("+")) {
    return features
      .split("+")
      .map((item) => item.trim())
      .filter((item) => item.length > 0).length;
  }

  return features
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export function layoutNavigationGraph(input: {
  nodes: ForceLayoutNodeInput[];
  edges: ForceLayoutEdgeInput[];
}): ForceLayoutResult {
  const size = resolveLayoutSize(input.nodes.length);

  if (input.nodes.length === 0) {
    return {
      width: size.width,
      height: size.height,
      nodes: [],
      edges: [],
    };
  }

  const nodes = createInitialNodes(input.nodes, size);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = input.edges.flatMap((edge): ForceLayoutEdge[] => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);

    if (!source || !target) {
      return [];
    }

    return [{ ...edge, source, target }];
  });

  simulate(nodes, edges, size);

  return {
    width: size.width,
    height: size.height,
    nodes,
    edges,
  };
}

function createInitialNodes(inputs: ForceLayoutNodeInput[], size: { height: number; width: number }): ForceLayoutNode[] {
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  const orbitRadius = Math.min(size.width, size.height) * 0.32;

  return inputs.map((input, index) => {
    const angle = inputs.length === 1 ? 0 : (Math.PI * 2 * index) / inputs.length - Math.PI / 2;
    const x = inputs.length === 1 ? centerX : centerX + Math.cos(angle) * orbitRadius;
    const y = inputs.length === 1 ? centerY : centerY + Math.sin(angle) * orbitRadius;
    const radius = radiusForFeatureCount(input.featureCount ?? 0);

    return {
      ...input,
      x: clamp(roundLayoutValue(x), radius, size.width - radius),
      y: clamp(roundLayoutValue(y), radius, size.height - radius),
      radius,
    };
  });
}

function simulate(nodes: ForceLayoutNode[], edges: ForceLayoutEdge[], size: { height: number; width: number }): void {
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

      velocity.x += (size.width / 2 - node.x) * 0.006;
      velocity.y += (size.height / 2 - node.y) * 0.006;
      velocity.x *= 0.82;
      velocity.y *= 0.82;

      node.x = clamp(roundLayoutValue(node.x + velocity.x), node.radius, size.width - node.radius);
      node.y = clamp(roundLayoutValue(node.y + velocity.y), node.radius, size.height - node.radius);
    }
  }
}

function resolveLayoutSize(nodeCount: number): { height: number; width: number } {
  const growthSteps = Math.floor(Math.max(0, nodeCount - 1) / 5);

  return {
    width: clamp(MIN_LAYOUT_WIDTH + growthSteps * 200, MIN_LAYOUT_WIDTH, MAX_LAYOUT_WIDTH),
    height: clamp(MIN_LAYOUT_HEIGHT + growthSteps * 200, MIN_LAYOUT_HEIGHT, MAX_LAYOUT_HEIGHT),
  };
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
