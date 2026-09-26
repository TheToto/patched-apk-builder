import { describe, it, expect } from 'vitest';
import { buildObtainiumDeepLink } from '../src/web/obtainium.js';

describe('Obtainium Deep Link Builder', () => {
  it('should generate valid obtainium URL and QR code URL', () => {
    const res = buildObtainiumDeepLink({
      id: 'com.google.android.youtube',
      name: 'YouTube',
      author: 'TheToto',
      pageUrl: 'https://apk.thetoto.fr/youtube.html',
      brand: 'Morphe'
    });

    expect(res.deepLink.startsWith('obtainium://app/')).toBe(true);
    expect(res.qrCodeUrl.includes('api.qrserver.com')).toBe(true);

    const decoded = JSON.parse(decodeURIComponent(res.deepLink.replace('obtainium://app/', '')));
    expect(decoded.id).toBe('com.google.android.youtube');
    expect(decoded.name).toBe('YouTube');
    expect(decoded.url).toBe('https://apk.thetoto.fr/youtube.html');
  });
});
