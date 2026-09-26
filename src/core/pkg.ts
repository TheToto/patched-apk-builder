import type { AppConfig } from './types.js';

const KNOWN_PACKAGES: Record<string, string> = {
  youtube: 'com.google.android.youtube',
  'youtube-experimental': 'com.google.android.youtube',
  music: 'com.google.android.apps.youtube.music',
  'youtube-music': 'com.google.android.apps.youtube.music',
  reddit: 'com.reddit.frontpage',
  gboard: 'com.google.android.inputmethod.latin',
  niagaralauncher: 'bitpit.launcher',
  niagara: 'bitpit.launcher',
  protonvpn: 'ch.protonvpn.android',
  twitter: 'com.twitter.android',
  googlephotos: 'com.google.android.apps.photos',
  photos: 'com.google.android.apps.photos',
  facebook: 'com.facebook.katana',
  messenger: 'com.facebook.orca',
  instagram: 'com.instagram.android',
  twitch: 'tv.twitch.android.app',
  discord: 'com.discord'
};

export function inferPackageName(app: AppConfig): string {
  if (app.pkgName && app.pkgName.trim()) {
    return app.pkgName.trim();
  }

  // Check archive.org URL if available
  if (app.archiveDlurl) {
    const parts = app.archiveDlurl.replace(/\/+$/, '').split('/');
    const last = parts[parts.length - 1];
    if (last && last.includes('.')) {
      return last;
    }
  }

  const slug = app.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (KNOWN_PACKAGES[slug]) {
    return KNOWN_PACKAGES[slug];
  }

  for (const [key, pkg] of Object.entries(KNOWN_PACKAGES)) {
    if (slug.includes(key)) {
      return pkg;
    }
  }

  return `com.${slug}`;
}
