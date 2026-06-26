/**
 * AdapterRegistry —— infra 层的适配器注册表。
 *
 * 持有所有 SourceAdapter 实现，按 detect 自动判别格式、按 id 查找。
 * 新增格式只需在组合根注册一个实现，本类无需改动。
 */

import type { SourceAdapter } from '../../domain/index.js';

export class AdapterRegistry {
  private readonly adapters: SourceAdapter[];

  constructor(adapters: SourceAdapter[]) {
    this.adapters = adapters;
  }

  byId(id: string): SourceAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  /** 用文件头判别归属的适配器，找不到返回 undefined。 */
  detect(locator: string, headLines: string[]): SourceAdapter | undefined {
    return this.adapters.find((a) => a.detect(locator, headLines));
  }

  all(): readonly SourceAdapter[] {
    return this.adapters;
  }
}
