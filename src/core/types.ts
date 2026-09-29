export type AppArchitecture = 'arm64-v8a' | 'arm-v7a' | 'both' | 'all' | 'x86_64' | 'x86';
export type ConcreteArch = 'arm64-v8a' | 'arm-v7a' | 'all' | 'x86_64' | 'x86';
export type BuildMode = 'apk' | 'module' | 'both';
export type StockInclude = 'disable' | 'merged' | 'split';
export type PatchMethod = 'revanced' | 'lspatch';

export interface GlobalConfig {
  enableModuleUpdate: boolean;
  parallelJobs: number;
  compressionLevel: number;
  patchesSource: string;
  patchesVersion: string;
  cliSource: string;
  cliVersion: string;
  rvBrand: string;
}

export interface AppConfig {
  slug: string;
  name: string;
  enabled: boolean;
  rvBrand: string;
  patchesSource: string;
  patchesVersion: string;
  cliSource: string;
  cliVersion: string;
  patchMethod: PatchMethod;
  xposedModuleAsset?: string;
  buildMode: BuildMode;
  arch: AppArchitecture;
  version: string;
  pkgName?: string;
  dpi?: string;
  includedPatches?: string[];
  excludedPatches?: string[];
  exclusivePatches: boolean;
  enableMicrog?: boolean;
  patcherArgs?: string;
  includeStock: StockInclude;
  enableUpdateChecks: boolean;
  modulePropName?: string;
  info?: string;
  apkmirrorDlurl?: string;
  archiveDlurl?: string;
  uptodownDlurl?: string;
  apkpureDlurl?: string;
  aptoideDlurl?: string;
  apkcomboDlurl?: string;
  githubDlurl?: string;
  directDlurl?: string;
  discordDlurl?: string;
}

export interface FullConfig {
  global: GlobalConfig;
  apps: Record<string, AppConfig>;
}

export interface PatchInfo {
  name: string;
  description: string;
  defaultEnabled: boolean;
  compatiblePackages: Array<{
    name: string;
    versions: string[];
  }>;
}

export interface PatchSelectionResult {
  name: string;
  description: string;
  default_enabled: boolean;
  explicitly_enabled: boolean;
  explicitly_disabled: boolean;
}

export interface PatchesSummaryJson {
  exclusive: boolean;
  patches: PatchSelectionResult[];
}

export interface ResolvedTarget {
  app: AppConfig;
  arch: ConcreteArch;
  version: string;
  pkgName: string;
  fingerprint: string;
  patchesTag: string;
  cliTag: string;
  patchesFile: string;
  cliFile: string;
  lspatchFile?: string;
  xposedModuleFile?: string;
}

export interface AppBuildState {
  version: string;
  patchesTag: string;
  cliTag: string;
  fingerprint: string;
  arch: string;
  buildMode: BuildMode;
  updatedAt: string;
  artifacts?: {
    apk?: string;
    module?: string;
    patchesJson?: string;
  };
}

export interface RepositoryState {
  lastVersionCode: number;
  updatedAt: string;
  apps: Record<string, AppBuildState>;
}
