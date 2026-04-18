import type { JobStore } from "./jobStore.js";
import type { JobRecord } from "./jobTypes.js";

/** `:id` 为纯数字时按 `seq` 解析，否则按 UUID 解析 */
export function getJobByRouteParam(store: JobStore, routeId: string): JobRecord | undefined {
  const t = routeId.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1) return store.getBySeq(n);
  }
  return store.getById(t);
}
