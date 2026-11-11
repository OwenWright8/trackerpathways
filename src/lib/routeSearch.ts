import { DataStructure, PathResult } from "@/types";

export const MAX_PATHS_LIMIT = 999;

export interface RouteSearchResult extends PathResult {
  stepDays: Array<number | null>;
}

export interface RouteSearchQuery {
  /** Comma-separated tracker names or abbreviations. */
  source: string;
  /** Tracker name or abbreviation. */
  target: string;
  maxJumps: number;
  maxDays: number | null;
}

/**
 * Builds a breadth-first route searcher over the tracker graph.
 *
 * Shared by the browser (so searching never hits the server) and the
 * /api/routes endpoint (kept for scripts and external integrations).
 */
export function createRouteSearcher(data: DataStructure) {
  const allTrackerKeys = Object.keys(data.routeInfo);
  const allTrackers = Array.from(new Set([
    ...allTrackerKeys,
    ...allTrackerKeys.flatMap((key) => Object.keys(data.routeInfo[key] || {})),
  ]));

  const getAbbr = (name: string) => {
    if (data.trackerInfo[name]) return data.trackerInfo[name].abbr;
    const capitals = name.match(/[A-Z]/g);
    if (capitals && capitals.length >= 2) return capitals.join("");
    return name.substring(0, 3).toUpperCase();
  };

  const strictTrackerIdentifiers = new Set(
    allTrackers.flatMap((trackerName) => [trackerName.toLowerCase(), getAbbr(trackerName).toLowerCase()])
  );

  return function searchRoutes({ source, target, maxJumps, maxDays }: RouteSearchQuery): RouteSearchResult[] {
    const sQueryRaw = source.toLowerCase().trim();
    const sourceInputs = sQueryRaw
      ? Array.from(new Set(sQueryRaw.split(",").map((s) => s.trim()).filter(Boolean)))
      : [];
    const tQuery = target.toLowerCase().trim();

    if (!sQueryRaw && !tQuery) return [];

    const isStrictTarget = strictTrackerIdentifiers.has(tQuery);

    let startNodes: string[] = [];
    if (sourceInputs.length > 0) {
      startNodes = allTrackerKeys.filter((trackerName) => {
        const trackerLower = trackerName.toLowerCase();
        const trackerAbbr = getAbbr(trackerName).toLowerCase();
        return sourceInputs.some((input) => {
          if (strictTrackerIdentifiers.has(input)) {
            return trackerLower === input || trackerAbbr === input;
          }
          return trackerLower.includes(input) || trackerAbbr === input;
        });
      });
    } else if (tQuery) {
      startNodes = allTrackerKeys;
    }

    const startNodeSet = new Set(startNodes);
    const results: RouteSearchResult[] = [];
    const queue: RouteSearchResult[] = startNodes.map((start) => ({
      source: start,
      target: start,
      nodes: [start],
      totalDays: 0,
      stepDays: [],
      routes: [],
    }));

    let pathsFound = 0;

    for (let queueIndex = 0; queueIndex < queue.length && pathsFound < MAX_PATHS_LIMIT; queueIndex += 1) {
      const currentPath = queue[queueIndex];
      const currentNode = currentPath.nodes[currentPath.nodes.length - 1];
      if (!currentNode) continue;

      if (currentPath.nodes.length > 1) {
        let isTargetMatch = true;
        if (tQuery) {
          const cName = currentNode.toLowerCase();
          const cAbbr = getAbbr(currentNode).toLowerCase();
          isTargetMatch = isStrictTarget
            ? cName === tQuery || cAbbr === tQuery
            : cName.includes(tQuery) || cAbbr.includes(tQuery);
        }

        if (isTargetMatch) {
          if (maxDays === null || (currentPath.totalDays !== null && currentPath.totalDays <= maxDays)) {
            results.push(currentPath);
            pathsFound++;
          }
        }
      }

      if (currentPath.routes.length >= maxJumps) continue;

      const neighbors = data.routeInfo[currentNode];
      if (!neighbors) continue;

      for (const [nextTracker, details] of Object.entries(neighbors)) {
        if (startNodeSet.has(nextTracker) && nextTracker.toLowerCase() !== tQuery) continue;
        if (currentPath.nodes.includes(nextTracker)) continue;

        const edgeDays = details.days;
        const forumDays = data.unlockInviteClass[currentNode]?.[0] ?? 0;
        const stepDays = edgeDays !== null ? Math.max(edgeDays, forumDays) : null;
        const nextTotalDays = (currentPath.totalDays === null || stepDays === null)
          ? null
          : currentPath.totalDays + stepDays;

        if (maxDays !== null && nextTotalDays !== null && nextTotalDays > maxDays) continue;

        queue.push({
          source: currentPath.source,
          target: nextTracker,
          nodes: [...currentPath.nodes, nextTracker],
          totalDays: nextTotalDays,
          stepDays: [...currentPath.stepDays, stepDays],
          routes: [...currentPath.routes, details],
        });
      }
    }

    results.sort((a, b) => {
      if (a.routes.length !== b.routes.length) return a.routes.length - b.routes.length;
      const aDays = a.totalDays ?? Number.POSITIVE_INFINITY;
      const bDays = b.totalDays ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return a.target.localeCompare(b.target);
    });

    return results;
  };
}
