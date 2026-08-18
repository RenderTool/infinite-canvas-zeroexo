#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    result[key] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return result;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

function parseMaterials(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [kind = 'image', url = ''] = item.split('|');
    return { kind, url };
  });
}

function nodeType(random, materials, stackRate) {
  if (random() < stackRate) return 'stacked-media';
  const available = [...new Set(materials.map((item) => item.kind))];
  return pick(random, available.length ? available : ['image', 'video', 'audio', 'text', 'storyboard']);
}

function createNode(index, type, material, columns, random) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const jitter = () => Math.round((random() - 0.5) * 42);
  const position = { x: column * 260 + jitter(), y: row * 210 + jitter() };
  const size = type === 'audio' ? { width: 360, height: 96 } : { width: 220, height: 160 };
  const payload = material ? { content: material.url, storageKey: material.url, sourceKind: material.kind } : {};
  return {
    id: `stress-node-${index}`,
    type,
    title: `${type} ${index}`,
    position,
    size,
    data: type === 'stacked-media'
      ? { schemaVersion: 1, cards: [], activeIndex: 0, stressSeed: true }
      : { ...payload, stressSeed: true },
  };
}

function edge(id, source, target, sourcePin = 'output', targetPin = 'input') {
  return { id: `stress-edge-${id}`, source: { nodeId: source, pinId: sourcePin }, target: { nodeId: target, pinId: targetPin } };
}

function buildEdges(nodes, mode, columns, random) {
  const edges = [];
  const seen = new Set();
  const add = (source, target, kind = 'grid') => {
    if (!nodes[source] || !nodes[target] || source === target) return;
    const key = `${source}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge(edges.length, nodes[source].id, nodes[target].id, kind, 'input'));
  };

  for (let i = 0; i < nodes.length; i += 1) {
    add(i, i + 1, 'chain');
    if (i + columns < nodes.length) add(i, i + columns);
    if (i + columns + 1 < nodes.length) add(i, i + columns + 1);
    if (mode === 'dense-grid') {
      if (i + columns - 1 < nodes.length && i % columns > 0) add(i, i + columns - 1);
      if (i + columns * 3 < nodes.length) add(i, i + columns * 3);
      if (random() < 0.18) add(i, Math.floor(random() * nodes.length), 'random');
    }
  }

  if (mode === 'complete') {
    for (let source = 0; source < nodes.length; source += 1) {
      for (let target = source + 1; target < nodes.length; target += 1) add(source, target, 'complete');
    }
  }
  return edges;
}

const options = args(process.argv.slice(2));
const count = Math.max(1, number(options.count, 1000));
const seed = number(options.seed, 20260818);
const columns = Math.max(1, number(options.columns, Math.ceil(Math.sqrt(count))));
const stackRate = Math.min(1, Math.max(0, number(options.stackRate, 0.08)));
const mode = options.mode || 'dense-grid';
const materials = parseMaterials(options.materials);
const random = seeded(seed);
const nodes = Array.from({ length: count }, (_, index) => {
  const type = nodeType(random, materials, stackRate);
  const material = materials.length ? pick(random, materials.filter((item) => item.kind === type) .length ? materials.filter((item) => item.kind === type) : materials) : undefined;
  return createNode(index, type, material, columns, random);
});
const edges = buildEdges(nodes, mode, columns, random);
const output = options.output || path.resolve(process.cwd(), `stress-${count}-${seed}-${mode}.json`);
const graph = {
  nodes,
  edges,
  viewport: { x: 80, y: 80, k: 0.42 },
  metadata: { stress: { count, seed, columns, mode, stackRate, materialCount: materials.length, edgeCount: edges.length } },
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(graph));
console.log(JSON.stringify({ output, nodes: nodes.length, edges: edges.length, seed, mode }, null, 2));
