export interface ObtainiumAppConfig {
  id: string; // Android Package Name, e.g. com.google.android.youtube
  name: string; // App display name
  author: string; // Repo owner or brand
  pageUrl: string; // Full web URL where APK is linked
  brand: string;
  isMagiskModule?: boolean;
}

export function buildObtainiumDeepLink(config: ObtainiumAppConfig): {
  deepLink: string;
  qrCodeUrl: string;
} {
  const additionalSettings: Record<string, any> = {
    versionExtractionRegEx: config.isMagiskModule
      ? '-module-v([0-9a-zA-Z._-]+)-(?:arm64-v8a|arm-v7a|x86_64|x86|all)\\.zip'
      : '-v([0-9a-zA-Z._-]+)-(?:arm64-v8a|arm-v7a|x86_64|x86|all)\\.apk',
    matchGroupToUse: '$1',
    defaultPseudoVersioningMethod: 'APKLinkHash',
    appName: config.name,
    appAuthor: config.author,
    about: `${config.name} ${config.brand}${config.isMagiskModule ? ' Magisk Module' : ''}`
  };

  if (config.isMagiskModule) {
    additionalSettings.isMagiskModule = true;
  }

  const payload = {
    id: config.id,
    url: config.pageUrl,
    author: config.author,
    name: config.name,
    preferredApkIndex: 0,
    additionalSettings: JSON.stringify(additionalSettings)
  };

  const jsonString = JSON.stringify(payload);
  const encodedPayload = encodeURIComponent(jsonString);
  const deepLink = `obtainium://app/${encodedPayload}`;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(deepLink)}`;

  return { deepLink, qrCodeUrl };
}
