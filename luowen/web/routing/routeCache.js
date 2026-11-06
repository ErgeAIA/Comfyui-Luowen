// 络纹 LuoWen — 路由缓存（阶段 1 简化版；CM registry 四件套之键与版本失效思想）
// 键内含端点/stub/方向/档位——兄弟线连断或参数变化自然换键，旧条目由容量上限回收。
// 版本 = 障碍 rect-hash 版本号：布局变化 → version++ → 隐式全量失效。

export function createRouteCache({ max = 4096 } = {}) {
  let map = new Map();
  let hits = 0;
  let misses = 0;
  return {
    get(key, version) {
      const e = map.get(key);
      if (e && e.version === version) {
        hits += 1;
        return e.pts;
      }
      misses += 1;
      return null;
    },
    set(key, version, pts) {
      if (map.size >= max) {
        map = new Map(); // 粗暴整体回收：条目廉价，重算受每帧预算保护
      }
      map.set(key, { version, pts });
    },
    stats() {
      return { size: map.size, hits, misses };
    },
    clear() {
      map = new Map();
      hits = 0;
      misses = 0;
    },
  };
}
