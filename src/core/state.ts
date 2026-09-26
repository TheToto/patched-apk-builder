import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AppConfig, ConcreteArch, RepositoryState, AppBuildState } from './types.js';
import type { AppContext } from './context.js';

export class StateManager {
  private stateFilePath: string;
  private state: RepositoryState;

  constructor(private ctx: AppContext) {
    this.stateFilePath = path.join(this.ctx.rootDir, 'build-state.json');
    this.state = this.loadState();
  }

  private loadState(): RepositoryState {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        this.ctx.warn(`Failed to parse ${this.stateFilePath}, starting fresh`);
      }
    }

    // Backward compatibility: If build.md exists, parse baseline versions
    const buildMdPath = path.join(this.ctx.rootDir, 'build.md');
    const baselineApps: Record<string, AppBuildState> = {};
    if (fs.existsSync(buildMdPath)) {
      try {
        const lines = fs.readFileSync(buildMdPath, 'utf-8').split('\n');
        for (const line of lines) {
          const m = line.match(/^([^:]+):\s*([0-9a-zA-Z.-]+)/);
          if (m && m[1] && m[2] && !line.startsWith('Patches:')) {
            const slug = m[1].trim().toLowerCase().replace(/\s+/g, '-');
            baselineApps[slug] = {
              version: m[2].trim(),
              patchesTag: '',
              cliTag: '',
              fingerprint: '',
              arch: 'all',
              buildMode: 'apk',
              updatedAt: new Date().toISOString()
            };
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      lastVersionCode: parseInt(this.ctx.nextVerCode, 10) || 1,
      updatedAt: new Date().toISOString(),
      apps: baselineApps
    };
  }

  public getState(): RepositoryState {
    return this.state;
  }

  public computeFingerprint(
    app: AppConfig,
    arch: ConcreteArch,
    targetVersion: string,
    patchesTag: string,
    cliTag: string
  ): string {
    const payload = JSON.stringify({
      slug: app.slug,
      arch,
      targetVersion,
      patchesSource: app.patchesSource,
      patchesTag,
      cliSource: app.cliSource,
      cliTag,
      patchMethod: app.patchMethod,
      xposedModuleAsset: app.xposedModuleAsset,
      includedPatches: app.includedPatches,
      excludedPatches: app.excludedPatches,
      exclusivePatches: app.exclusivePatches,
      buildMode: app.buildMode
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  public hasAppChanged(
    slug: string,
    arch: ConcreteArch,
    newFingerprint: string,
    targetVersion: string
  ): boolean {
    const key = `${slug}:${arch}`;
    const previous = this.state.apps[key] || this.state.apps[slug];
    if (!previous) return true;
    if (previous.fingerprint && previous.fingerprint === newFingerprint) {
      return false;
    }
    // Fallback if previous had no fingerprint (e.g. imported from build.md)
    if (!previous.fingerprint && previous.version === targetVersion) {
      return false;
    }
    return true;
  }

  public recordAppBuild(
    slug: string,
    arch: ConcreteArch,
    data: {
      version: string;
      patchesTag: string;
      cliTag: string;
      fingerprint: string;
      buildMode: any;
      artifacts?: { apk?: string; module?: string; patchesJson?: string };
    }
  ): void {
    const key = `${slug}:${arch}`;
    this.state.apps[key] = {
      ...data,
      arch,
      updatedAt: new Date().toISOString()
    };
  }

  public save(): void {
    this.state.updatedAt = new Date().toISOString();
    this.state.lastVersionCode = parseInt(this.ctx.nextVerCode, 10) || this.state.lastVersionCode;
    fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  public exportBuildMd(builtList: Array<{ name: string; version: string; patchesTag?: string }>): void {
    const buildMdPath = path.join(this.ctx.rootDir, 'build.md');
    let content = '';
    for (const item of builtList) {
      content += `${item.name}: ${item.version}  \n`;
    }
    content += '\nInstall [Microg](https://github.com/MorpheApp/MicroG-RE/) for non-root YouTube and YT Music APKs  \n';
    content += 'Use [zygisk-detach](https://github.com/j-hc/zygisk-detach) to detach YouTube and YT Music modules from Play Store  \n\n';
    content += `[revanced-magisk-module](https://${this.ctx.githubRepository})  \n\n`;

    const patchTagsSeen = new Set<string>();
    for (const item of builtList) {
      if (item.patchesTag && !patchTagsSeen.has(item.patchesTag)) {
        patchTagsSeen.add(item.patchesTag);
        content += `Patches: ${item.patchesTag}  \n`;
      }
    }

    fs.writeFileSync(buildMdPath, content, 'utf-8');
  }
}
