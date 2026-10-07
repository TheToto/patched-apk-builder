import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from './core/context.js';
import type { AppConfig, ConcreteArch, FullConfig, BuildMode } from './core/types.js';
import { ToolManager } from './tools/tool-manager.js';
import { ReleaseFetcher } from './patches/fetcher.js';
import { PatchInspector } from './patches/inspector.js';
import { PatchResolver } from './patches/resolver.js';
import { ApkResolver } from './apk/resolver.js';
import { ApkBuilder } from './builders/apk-builder.js';
import { ModuleBuilder } from './builders/module-builder.js';
import { StateManager } from './core/state.js';
import { AaptTool } from './tools/aapt.js';
import { inferPackageName } from './core/pkg.js';

export class BuildOrchestrator {
  private toolManager: ToolManager;
  private fetcher: ReleaseFetcher;
  private inspector: PatchInspector;
  private resolver: PatchResolver;
  private apkResolver: ApkResolver;
  private apkBuilder: ApkBuilder;
  private moduleBuilder: ModuleBuilder;
  private stateManager: StateManager;
  private aapt: AaptTool;

  constructor(private ctx: AppContext) {
    this.toolManager = new ToolManager(this.ctx);
    this.fetcher = new ReleaseFetcher(this.ctx);
    this.inspector = new PatchInspector(this.ctx);
    this.resolver = new PatchResolver(this.inspector);
    this.apkResolver = new ApkResolver(this.ctx);
    this.apkBuilder = new ApkBuilder(this.ctx);
    this.moduleBuilder = new ModuleBuilder(this.ctx);
    this.stateManager = new StateManager(this.ctx);
    this.aapt = new AaptTool(this.ctx);
  }

  public async buildSingle(
    config: FullConfig,
    appSlug: string,
    arch?: ConcreteArch,
    forcedVersion?: string
  ): Promise<void> {
    const app = config.apps[appSlug];
    if (!app) {
      throw new Error(`Application '${appSlug}' not found in configuration`);
    }

    await this.toolManager.ensureCmprBinaries();

    // 1. Fetch patches / module bundle & tools
    let patchRelease: { tag: string; filePath: string };
    let cliJar = '';
    let cliTag = 'lspatch';
    let lspatchJar = '';
    let xposedModuleApk = '';

    if (app.patchMethod === 'lspatch') {
      lspatchJar = await this.toolManager.getLsPatchJar();
      if (!app.xposedModuleAsset) {
        throw new Error(`xposed-module-asset required for LSPatch in ${app.name}`);
      }
      const modAsset = await this.fetcher.getAssetByPattern(
        app.patchesSource,
        app.xposedModuleAsset,
        app.patchesVersion
      );
      xposedModuleApk = modAsset.filePath;
      patchRelease = {
        tag: modAsset.tag,
        filePath: modAsset.filePath
      };
    } else {
      patchRelease = await this.fetcher.getPatchesBundle(app.patchesSource, app.patchesVersion);
      const cliRelease = await this.fetcher.getCliJar(app.cliSource, app.cliVersion);
      cliJar = cliRelease.filePath;
      cliTag = cliRelease.tag;
    }

    // 2. Resolve package name
    const pkgName = inferPackageName(app);

    // 3. Resolve target version
    const targetVersion =
      forcedVersion ||
      (await this.resolver.resolveTargetVersion(app, cliJar, patchRelease.filePath, pkgName));

    const archesToBuild: ConcreteArch[] = arch
      ? [arch]
      : app.arch === 'both'
        ? ['arm64-v8a', 'arm-v7a']
        : [app.arch as ConcreteArch];

    for (const concreteArch of archesToBuild) {
      await this.buildAppTarget({
        app,
        arch: concreteArch,
        targetVersion,
        pkgName,
        patchRelease,
        cliJar,
        cliTag,
        lspatchJar,
        xposedModuleApk
      });
    }
  }

  private async buildAppTarget(opts: {
    app: AppConfig;
    arch: ConcreteArch;
    targetVersion: string;
    pkgName: string;
    patchRelease: { tag: string; filePath: string };
    cliJar: string;
    cliTag: string;
    lspatchJar?: string;
    xposedModuleApk?: string;
  }): Promise<void> {
    const { app, arch, targetVersion, pkgName, patchRelease, cliJar, cliTag, lspatchJar, xposedModuleApk } =
      opts;

    this.ctx.log(
      `--- Starting Build: ${app.name} (${arch}) Version: ${targetVersion} [${app.rvBrand}] ---`
    );

    // 1. Download & verify stock APK
    const stockApk = await this.apkResolver.acquireStockApk(app, targetVersion, arch, pkgName);

    // 2. Standardized naming: appslug-patchname-version-patchversion-arch.apk
    const appSlug = app.slug.toLowerCase().replace(/\s+/g, '-');
    const patchName = app.rvBrand.toLowerCase().replace(/\s+/g, '-');
    const archClean = arch.replace(/\s+/g, '-');

    // Clean version string: remove leading 'v', spaces, and release/arch suffixes (e.g. -release-arm64-v8a)
    const cleanVer = targetVersion
      .replace(/^v/, '')
      .replace(/\s+/g, '-')
      .replace(/-release.*$/i, '')
      .replace(new RegExp(`-${archClean}$`, 'i'), '');

    // Patch version prefixed with 'p' (or 'lsp' for LSPatch)
    const patchTag = patchRelease.tag.replace(/^v/, '').replace(/^p/, '').replace(/\s+/g, '-');
    const patchVerStr = app.patchMethod === 'lspatch' ? 'lsp' : `p${patchTag}`;

    const artifactBaseName = `${appSlug}-${patchName}-v${cleanVer}-${patchVerStr}-${archClean}`;

    const modes: BuildMode[] =
      app.buildMode === 'both' ? ['apk', 'module'] : [app.buildMode];

    // Inspect patches list once if ReVanced
    let allPatchesListRaw = '';
    if (app.patchMethod !== 'lspatch') {
      const isExp = app.version === 'experimental' || app.slug.includes('experimental');
      allPatchesListRaw = await this.inspector.getPatchesListRaw(
        cliJar,
        patchRelease.filePath,
        pkgName,
        isExp
      );

      // Detect microg patch if any to reflect in patches.json summary
      const microgMatch = allPatchesListRaw.match(/Name:\s*([^\n]*(?:gmscore|microg)[^\n]*)/i);
      const microgPatchName = microgMatch && microgMatch[1] ? microgMatch[1].trim() : null;

      const effectiveIncluded = [...(app.includedPatches || [])];
      const effectiveExcluded = [...(app.excludedPatches || [])];

      if (microgPatchName) {
        const isInc = effectiveIncluded.some((p) => p.toLowerCase() === microgPatchName.toLowerCase());
        const isExc = effectiveExcluded.some((p) => p.toLowerCase() === microgPatchName.toLowerCase());
        if (app.enableMicrog && !isInc && !isExc) {
          effectiveIncluded.push(microgPatchName);
        } else if (!app.enableMicrog && !isInc && !isExc) {
          effectiveExcluded.push(microgPatchName);
        }
      }

      // Save patches.json alongside artifacts
      const patchesSummary = this.inspector.buildPatchesSummary(
        allPatchesListRaw,
        effectiveIncluded,
        effectiveExcluded,
        app.exclusivePatches
      );
      const patchesJsonPath = path.join(
        this.ctx.buildDir,
        `${artifactBaseName}.patches.json`
      );
      fs.writeFileSync(patchesJsonPath, JSON.stringify(patchesSummary, null, 2), 'utf-8');
    }

    let finalApkPath: string | null = null;
    let finalModulePath: string | null = null;

    for (const mode of modes) {
      const isModule = mode === 'module';
      const strippedStock = path.join(
        this.ctx.tempDir,
        `${pkgName}-${cleanVer}-${archClean}-${mode}.stripped.apk`
      );

      await this.apkBuilder.stripUnwantedLibs(stockApk, strippedStock, arch, isModule);

      const patchedTemp = path.join(
        this.ctx.tempDir,
        `${artifactBaseName}-${mode}.apk`
      );

      if (app.patchMethod === 'lspatch') {
        await this.apkBuilder.patchWithLsPatch(
          strippedStock,
          lspatchJar!,
          xposedModuleApk!,
          patchedTemp
        );
      } else {
        await this.apkBuilder.patchWithReVanced(
          strippedStock,
          cliJar,
          patchRelease.filePath,
          app,
          mode,
          allPatchesListRaw,
          patchedTemp
        );
      }

      if (mode === 'apk') {
        const outApk = path.join(
          this.ctx.buildDir,
          `${artifactBaseName}.apk`
        );
        fs.copyFileSync(patchedTemp, outApk);
        finalApkPath = outApk;
        this.ctx.success(`Built standalone APK: ${outApk}`);

        // Extract app icon to build dir for pages
        const iconPath = path.join(this.ctx.buildDir, `${app.slug}.png`);
        if (!fs.existsSync(iconPath)) {
          await this.aapt.extractIcon(outApk, iconPath, app.slug);
        }
      }

      if (mode === 'module') {
        const outZip = await this.moduleBuilder.buildMagiskModule(
          app,
          arch,
          cleanVer,
          patchVerStr,
          pkgName,
          patchedTemp,
          stockApk
        );
        finalModulePath = outZip;
      }
    }

    // Record build state and save
    const fingerprint = this.stateManager.computeFingerprint(
      app,
      arch,
      targetVersion,
      patchRelease.tag,
      cliTag
    );

    const entryData = {
      version: targetVersion,
      patchesTag: patchRelease.tag,
      cliTag,
      fingerprint,
      buildMode: app.buildMode,
      artifacts: {
        apk: finalApkPath ? path.basename(finalApkPath) : undefined,
        module: finalModulePath ? path.basename(finalModulePath) : undefined
      }
    };

    this.stateManager.recordAppBuild(app.slug, arch, entryData);
    this.stateManager.save();

    // Export individual state entry for isolated CI matrix consolidation
    const singleStateFile = path.join(this.ctx.buildDir, `state-${app.slug}-${arch}.json`);
    fs.writeFileSync(
      singleStateFile,
      JSON.stringify(
        {
          key: `${app.slug}:${arch}`,
          entry: {
            ...entryData,
            arch,
            updatedAt: new Date().toISOString()
          }
        },
        null,
        2
      ),
      'utf-8'
    );
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
