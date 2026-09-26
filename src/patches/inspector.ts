import path from 'node:path';
import type { AppContext } from '../core/context.js';
import type { PatchInfo, PatchesSummaryJson, PatchSelectionResult } from '../core/types.js';
import { sortVersionsDescending } from '../core/version.js';

export class PatchInspector {
  constructor(private ctx: AppContext) {}

  public async getPatchesListRaw(
    cliJar: string,
    patchesJar: string,
    pkgName: string,
    isExperimental: boolean = false
  ): Promise<string> {
    const isMorphe = path.basename(cliJar).toLowerCase().includes('morphe');

    // Try format 1 (ReVanced newer / Morphe)
    const args1 = [
      '-jar',
      cliJar,
      'list-patches',
      `--patches=${patchesJar}`,
      `-f=${pkgName}`,
      '--with-versions',
      '--with-packages'
    ];
    if (isExperimental) args1.push('-x');
    if (!isMorphe) args1.push('-b');

    try {
      const { stdout } = await this.ctx.exec('java', args1, { silent: true });
      if (stdout.includes('Name:')) return stdout;
    } catch {
      // try fallback
    }

    // Try format 2 (ReVanced older)
    const args2 = [
      '-jar',
      cliJar,
      'list-patches',
      '-p',
      patchesJar,
      '--filter-package-name',
      pkgName,
      '--versions',
      '--packages'
    ];
    if (isExperimental) args2.push('-x');
    if (!isMorphe) args2.push('-b');

    try {
      const { stdout } = await this.ctx.exec('java', args2, { silent: true });
      return stdout;
    } catch (err: any) {
      this.ctx.warn(`Could not list patches for ${pkgName}: ${err.message}`);
      return '';
    }
  }

  public async getCompatibleVersions(
    cliJar: string,
    patchesJar: string,
    pkgName: string,
    isExperimental: boolean = false
  ): Promise<string[]> {
    const isMorphe = path.basename(cliJar).toLowerCase().includes('morphe');
    const baseArgs = ['-jar', cliJar, 'list-versions'];
    if (!isMorphe) baseArgs.push('-b');
    if (isExperimental) baseArgs.push('-x');

    // Try `--patches` flag
    try {
      const { stdout } = await this.ctx.exec(
        'java',
        [...baseArgs, `--patches=${patchesJar}`, `-f=${pkgName}`],
        { silent: true }
      );
      const versions = this.parseListVersionsOutput(stdout);
      if (versions.length > 0) return versions;
    } catch {
      // fallback below
    }

    // Try positional argument
    try {
      const { stdout } = await this.ctx.exec(
        'java',
        [...baseArgs, patchesJar, '-f', pkgName],
        { silent: true }
      );
      const versions = this.parseListVersionsOutput(stdout);
      if (versions.length > 0) return versions;
    } catch (err: any) {
      this.ctx.warn(`Could not list versions for ${pkgName}: ${err.message}`);
    }

    return [];
  }

  private parseListVersionsOutput(stdout: string): string[] {
    const lines = stdout.split('\n');
    const idx = lines.findIndex((l) => l.includes('Most common compatible versions:'));
    if (idx === -1) {
      // Look for any version lines
      const found = stdout.match(/\b\d+(\.\d+)+[a-zA-Z0-9_.-]*\b/g);
      return found ? sortVersionsDescending([...new Set(found)]) : [];
    }

    const versions: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('━') || line.startsWith('-')) continue;
      const v = line.split(/\s+/)[0];
      if (v && v.toLowerCase() !== 'any' && !v.startsWith('INFO:')) {
        versions.push(v);
      }
    }

    return sortVersionsDescending(versions);
  }

  public parsePatchesList(rawOutput: string): PatchInfo[] {
    const patches: PatchInfo[] = [];
    const lines = rawOutput.split('\n');

    let currentName: string | null = null;
    let currentDesc = '';
    let currentEnabled = true;
    let inVersions = false;
    let currentVersions: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('Name:')) {
        if (currentName) {
          patches.push({
            name: currentName,
            description: currentDesc,
            defaultEnabled: currentEnabled,
            compatiblePackages: [{ name: '', versions: currentVersions }]
          });
        }
        currentName = line.substring(5).trim();
        currentDesc = '';
        currentEnabled = true;
        currentVersions = [];
        inVersions = false;
      } else if (line.startsWith('Description:')) {
        currentDesc = line.substring(12).trim();
        inVersions = false;
      } else if (line.startsWith('Enabled:')) {
        currentEnabled = line.substring(8).trim().toLowerCase() === 'true';
        inVersions = false;
      } else if (line.startsWith('Compatible versions:')) {
        inVersions = true;
      } else if (inVersions) {
        if (line.startsWith('-')) {
          currentVersions.push(line.replace(/^-+\s*/, '').trim());
        } else if (line.length === 0) {
          inVersions = false;
        }
      }
    }

    if (currentName) {
      patches.push({
        name: currentName,
        description: currentDesc,
        defaultEnabled: currentEnabled,
        compatiblePackages: [{ name: '', versions: currentVersions }]
      });
    }

    return patches;
  }

  public buildPatchesSummary(
    rawPatchesOutput: string,
    includedPatches: string[] = [],
    excludedPatches: string[] = [],
    exclusive: boolean = false
  ): PatchesSummaryJson {
    const norm = (s: string) => s.toLowerCase().replace(/['"\\\s]+/g, '');
    const incSet = new Set(includedPatches.map(norm));
    const excSet = new Set(excludedPatches.map(norm));

    const patches = this.parsePatchesList(rawPatchesOutput);
    const summaryList: PatchSelectionResult[] = patches.map((p) => {
      const n = norm(p.name);
      return {
        name: p.name,
        description: p.description,
        default_enabled: p.defaultEnabled,
        explicitly_enabled: incSet.has(n),
        explicitly_disabled: excSet.has(n)
      };
    });

    return {
      exclusive,
      patches: summaryList
    };
  }
}
