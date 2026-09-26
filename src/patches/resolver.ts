import type { AppConfig } from '../core/types.js';
import type { PatchInspector } from './inspector.js';

export class PatchResolver {
  constructor(private inspector: PatchInspector) {}

  public async resolveTargetVersion(
    app: AppConfig,
    cliJar: string,
    patchesJar: string,
    pkgName: string
  ): Promise<string> {
    const mode = app.version.trim();

    // If a pinned version number was specified
    if (mode !== 'auto' && mode !== 'experimental' && mode !== 'latest') {
      return mode;
    }

    if (app.patchMethod === 'lspatch') {
      return 'latest';
    }

    const isExperimental = mode === 'experimental' || app.slug.includes('experimental');
    const versions = await this.inspector.getCompatibleVersions(
      cliJar,
      patchesJar,
      pkgName,
      isExperimental
    );

    if (versions.length > 0) {
      return versions[0]; // Already sorted descending
    }

    // If auto/experimental returned no list, fallback to latest
    return 'latest';
  }
}
