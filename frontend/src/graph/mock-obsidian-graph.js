const TOPICS = Object.freeze([
  "品牌经营",
  "供应链",
  "商品库存",
  "渠道用户",
  "产业地图",
  "数字化与 AI",
  "面料工艺",
  "行业资料",
]);
const MOCK_GRAPH_UPDATED_AT_UTC = new Date().toISOString();

export function createMockObsidianGraph() {
  const nodes = [{
    id: "vault",
    title: "服装行业知识库",
    relativePath: "00-Obsidian主页.md",
    kind: "home",
    group: "vault",
    tags: ["obsidian", "知识库"],
    resolved: true,
    weight: 8,
  }];
  const edges = [];

  TOPICS.forEach((topic, topicIndex) => {
    const hubId = `topic-${topicIndex}`;
    nodes.push({
      id: hubId,
      title: topic,
      relativePath: `知识库/${topic}/00-MOC.md`,
      kind: "moc",
      group: topic,
      tags: [topic],
      resolved: true,
      weight: 5,
    });
    edges.push({ id: `vault-${hubId}`, source: "vault", target: hubId, kind: "wikilink" });

    for (let noteIndex = 0; noteIndex < 11; noteIndex += 1) {
      const id = `${hubId}-note-${noteIndex}`;
      nodes.push({
        id,
        title: `${topic} · ${String(noteIndex + 1).padStart(2, "0")}`,
        relativePath: `知识库/${topic}/${String(noteIndex + 1).padStart(2, "0")}.md`,
        kind: "note",
        group: topic,
        tags: [topic, noteIndex % 3 === 0 ? "重点" : "资料"],
        resolved: true,
        weight: noteIndex % 5 === 0 ? 2 : 1,
      });
      edges.push({ id: `${hubId}-${id}`, source: hubId, target: id, kind: "wikilink" });
      if (noteIndex > 0 && noteIndex % 3 === 0) {
        edges.push({
          id: `${id}-previous`,
          source: id,
          target: `${hubId}-note-${noteIndex - 1}`,
          kind: "related",
        });
      }
    }
  });

  TOPICS.forEach((_, topicIndex) => {
    const nextIndex = (topicIndex + 3) % TOPICS.length;
    edges.push({
      id: `cross-${topicIndex}-${nextIndex}`,
      source: `topic-${topicIndex}-note-5`,
      target: `topic-${nextIndex}-note-2`,
      kind: "related",
    });
  });

  return {
    schemaVersion: 1,
    available: true,
    source: {
      kind: "obsidian",
      name: "OBSIDIAN GRAPH PREVIEW",
      simulation: true,
      revision: "preview-v1",
      updatedAtUtc: MOCK_GRAPH_UPDATED_AT_UTC,
    },
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      resolvedEdgeCount: edges.length,
      unresolvedNodeCount: 0,
      truncated: false,
    },
  };
}
