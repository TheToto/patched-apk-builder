import type { AppContext } from '../core/context.js';
import type { AppConfig, ConcreteArch, FullConfig } from '../core/types.js';
import { ReleaseFetcher } from '../patches/fetcher.js';
import { PatchInspector } from '../patches/inspector.js';
import { PatchResolver } from '../patches/resolver.js';
import { StateManager } from '../core/state.js';
import { ToolManager } from '../tools/tool-manager.js';

import { inferPackageName } from '../core/pkg.js';

export interface ChangedTarget {
  slug: string;
  name: string;
  arch: ConcreteArch;
  version: string;
  buildMode: string;
  patchesTag: string;
  cliTag: string;
  fingerprint: string;
}

export interface CheckResult {
  shouldBuild: boolean;
  changedTargets: ChangedTarget[];
  matrixJson: string;
}

export class ChangeDetector {
  private fetcher: ReleaseFetcher;
  private inspector: PatchInspector;
  private resolver: PatchResolver;
  private stateManager: StateManager;
  private toolManager: ToolManager;

  constructor(private ctx: AppContext) {
    this.fetcher = new ReleaseFetcher(this.ctx);
    this.inspector = new PatchInspector(this.ctx);
    this.resolver = new PatchResolver(this.inspector);
    this.stateManager = new StateManager(this.ctx);
    this.toolManager = new ToolManager(this.ctx);
  }

  public async detectChanges(config: FullConfig, options?: { force?: boolean }): Promise<CheckResult> {
    const changedTargets: ChangedTarget[] = [];
    const activeApps = Object.values(config.apps).filter((a) => a.enabled);

    // Cache release info so we don't query same repo multiple times
    const patchReleaseCache = new Map<string, { tag: string; filePath: string }>();
    const cliReleaseCache = new Map<string, { tag: string; filePath: string }>();

    for (const app of activeApps) {
      this.ctx.log(`Checking updates for ${app.name} (${app.slug})...`);

      // 1. Get patch bundle info
      let patchInfo = patchReleaseCache.get(`${app.patchesSource}:${app.patchesVersion}`);
      if (!patchInfo) {
        try {
          if (app.patchMethod === 'lspatch') {
            if (app.xposedModuleAsset) {
              patchInfo = await this.fetcher.getAssetByPattern(
                app.patchesSource,
                app.xposedModuleAsset,
                app.patchesVersion
              );
              patchReleaseCache.set(`${app.patchesSource}:${app.patchesVersion}`, patchInfo);
            } else {
              throw new Error(`xposed-module-asset required for LSPatch in ${app.name}`);
            }
          } else {
            patchInfo = await this.fetcher.getPatchesBundle(app.patchesSource, app.patchesVersion);
            patchReleaseCache.set(`${app.patchesSource}:${app.patchesVersion}`, patchInfo);
          }
        } catch (err: any) {
          this.ctx.warn(`Failed to fetch patches for ${app.name}: ${err.message}`);
          continue;
        }
      }

      // 2. Get CLI info
      let cliInfo = cliReleaseCache.get(`${app.cliSource}:${app.cliVersion}`);
      if (!cliInfo && app.patchMethod !== 'lspatch') {
        try {
          cliInfo = await this.fetcher.getCliJar(app.cliSource, app.cliVersion);
          cliReleaseCache.set(`${app.cliSource}:${app.cliVersion}`, cliInfo);
        } catch (err: any) {
          this.ctx.warn(`Failed to fetch CLI for ${app.name}: ${err.message}`);
          continue;
        }
      }

      const cliTag = cliInfo ? cliInfo.tag : 'lspatch';
      const cliJar = cliInfo ? cliInfo.filePath : '';

      // 3. Resolve target version
      const pkgName = inferPackageName(app);
      let targetVersion: string;
      try {
        targetVersion = await this.resolver.resolveTargetVersion(
          app,
          cliJar,
          patchInfo.filePath,
          pkgName
        );
      } catch (err: any) {
        this.ctx.warn(`Could not resolve version for ${app.name}: ${err.message}`);
        targetVersion = 'latest';
      }

      // 4. Expand architectures
      const concreteArches: ConcreteArch[] =
        app.arch === 'both' ? ['arm64-v8a', 'arm-v7a'] : [app.arch as ConcreteArch];

      for (const arch of concreteArches) {
        const fp = this.stateManager.computeFingerprint(
          app,
          arch,
          targetVersion,
          patchInfo.tag,
          cliTag
        );

        const hasChanged = options?.force || this.stateManager.hasAppChanged(app.slug, arch, fp, targetVersion);
        if (hasChanged) {
          this.ctx.log(
            options?.force
              ? `→ [FORCE] Rebuild scheduled for ${app.name} [${arch}] (Target: ${targetVersion})`
              : `→ Update needed for ${app.name} [${arch}] (Target: ${targetVersion}, Patches: ${patchInfo.tag})`
          );
          changedTargets.push({
            slug: app.slug,
            name: app.name,
            arch,
            version: targetVersion,
            buildMode: app.buildMode,
            patchesTag: patchInfo.tag,
            cliTag,
            fingerprint: fp
          });
        } else {
          this.ctx.log(`✓ ${app.name} [${arch}] is up to date (Version: ${targetVersion})`);
        }
      }
    }

    const shouldBuild = changedTargets.length > 0;
    const matrix = {
      include: changedTargets.map((t) => ({
        slug: t.slug,
        name: t.name,
        arch: t.arch,
        version: t.version,
        buildMode: t.buildMode
      }))
    };

    return {
      shouldBuild,
      changedTargets,
      matrixJson: JSON.stringify(matrix)
    };
  }

  private inferPkgName(app: AppConfig): string {
    if (app.slug.includes('youtube-music') || app.slug === 'music') {
      return 'com.google.android.apps.youtube.music';
    }
    if (app.slug.includes('youtube')) {
      return 'com.google.android.youtube';
    }
    if (app.slug.includes('reddit')) {
      return 'com.reddit.frontpage';
    }
    if (app.slug.includes('gboard')) {
      return 'com.google.android.inputmethod.latin';
    }
    if (app.slug.includes('twitter')) {
      return 'com.twitter.android';
    }
    if (app.slug.includes('photos')) {
      return 'com.google.android.apps.photos';
    }
    if (app.slug.includes('twitch')) {
      return 'tv.twitch.android.app';
    }
    return `com.${app.slug}`;
  }
}
