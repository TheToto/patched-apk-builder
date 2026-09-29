import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { rawAppConfigSchema, rawGlobalConfigSchema } from './schema.js';
import type { AppConfig, FullConfig, GlobalConfig } from '../core/types.js';

export function loadConfig(configFilePath: string): FullConfig {
  const fullPath = path.resolve(configFilePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found at: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  let raw: Record<string, any>;

  if (fullPath.endsWith('.json')) {
    raw = JSON.parse(content);
  } else {
    raw = parseToml(content) as Record<string, any>;
  }

  // Extract top-level global settings
  const rawGlobal: Record<string, any> = {};
  const rawApps: Record<string, Record<string, any>> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      rawApps[key] = value;
    } else {
      rawGlobal[key] = value;
    }
  }

  const parsedGlobal = rawGlobalConfigSchema.parse(rawGlobal);
  const globalConfig: GlobalConfig = {
    enableModuleUpdate: parsedGlobal['enable-module-update'],
    parallelJobs: parsedGlobal['parallel-jobs'],
    compressionLevel: parsedGlobal['compression-level'],
    patchesSource: parsedGlobal['patches-source'],
    patchesVersion: parsedGlobal['patches-version'],
    cliSource: parsedGlobal['cli-source'],
    cliVersion: parsedGlobal['cli-version'],
    rvBrand: parsedGlobal['rv-brand'] || parsedGlobal['patches-source'].split('/')[0] || 'ReVanced'
  };

  const apps: Record<string, AppConfig> = {};

  for (const [sectionName, appRaw] of Object.entries(rawApps)) {
    const parsedApp = rawAppConfigSchema.parse(appRaw);
    const slug = sectionName.toLowerCase().replace(/\s+/g, '-');
    const name = parsedApp['app-name'] || sectionName;
    const patchesSource = parsedApp['patches-source'] || globalConfig.patchesSource;
    const cliSource = parsedApp['cli-source'] || globalConfig.cliSource;

    let rvBrand = parsedApp['rv-brand'];
    if (!rvBrand) {
      rvBrand = globalConfig.rvBrand || patchesSource.split('/')[0] || 'ReVanced';
    }

    const appConfig: AppConfig = {
      slug,
      name,
      enabled: parsedApp.enabled,
      rvBrand,
      patchesSource,
      patchesVersion: parsedApp['patches-version'] || globalConfig.patchesVersion,
      cliSource,
      cliVersion: parsedApp['cli-version'] || globalConfig.cliVersion,
      patchMethod: parsedApp['patch-method'],
      xposedModuleAsset: parsedApp['xposed-module-asset'],
      buildMode: parsedApp['build-mode'],
      arch: parsedApp.arch,
      version: parsedApp.version,
      pkgName: parsedApp['pkg-name'],
      dpi: parsedApp.dpi,
      includedPatches: parsedApp['included-patches'],
      excludedPatches: parsedApp['excluded-patches'],
      exclusivePatches: parsedApp['exclusive-patches'],
      enableMicrog: parsedApp['enable-microg'] ?? parsedApp.microg ?? false,
      patcherArgs: parsedApp['patcher-args'],
      includeStock: parsedApp['include-stock'],
      enableUpdateChecks: parsedApp['enable-update-checks'],
      modulePropName: parsedApp['module-prop-name'] || `${slug}-jhc`,
      info: parsedApp.info,
      apkmirrorDlurl: parsedApp['apkmirror-dlurl'],
      archiveDlurl: parsedApp['archive-dlurl'],
      uptodownDlurl: parsedApp['uptodown-dlurl'],
      apkpureDlurl: parsedApp['apkpure-dlurl'],
      aptoideDlurl: parsedApp['aptoide-dlurl'],
      apkcomboDlurl: parsedApp['apkcombo-dlurl'],
      githubDlurl: parsedApp['github-dlurl'],
      directDlurl: parsedApp['direct-dlurl'],
      discordDlurl: parsedApp['discord-dlurl']
    };

    apps[slug] = appConfig;
  }

  return {
    global: globalConfig,
    apps
  };
}
