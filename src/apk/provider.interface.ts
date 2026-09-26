export interface ApkDownloadQuery {
  pkgName: string;
  version: string;
  arch: string;
  dpi?: string;
  destPath: string;
  sourceUrl?: string;
}

export interface ApkProviderResult {
  filePath: string;
  isBundle: boolean;
  versionFound: string;
}

export interface ApkProvider {
  name: string;
  canHandle(query: ApkDownloadQuery): boolean;
  download(query: ApkDownloadQuery): Promise<ApkProviderResult>;
}
