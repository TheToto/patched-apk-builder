/**
 * Robust version parser and comparator for Android app versions.
 * Handles semver, date-based versions (2026.13.0), build codes, and suffixes.
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = a.replace(/^v/, '').trim();
  const cleanB = b.replace(/^v/, '').trim();

  const partsA = cleanA.split(/[.-]/);
  const partsB = cleanB.split(/[.-]/);

  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const valA = partsA[i];
    const valB = partsB[i];

    if (valA === undefined) return -1;
    if (valB === undefined) return 1;

    const numA = parseInt(valA, 10);
    const numB = parseInt(valB, 10);

    const isNumA = !isNaN(numA) && /^\d+$/.test(valA);
    const isNumB = !isNaN(numB) && /^\d+$/.test(valB);

    if (isNumA && isNumB) {
      if (numA !== numB) {
        return numA > numB ? 1 : -1;
      }
    } else {
      const cmp = valA.localeCompare(valB);
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}
