import { describe, it, expect } from 'vitest';
import { compareVersions, sortVersionsDescending } from '../src/core/version.js';

describe('Version comparator', () => {
  it('should compare standard semver', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.5.0', '1.5.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });

  it('should compare date-based versions like Reddit', () => {
    expect(compareVersions('2026.14.0', '2026.13.0')).toBe(1);
    expect(compareVersions('2026.01.0', '2025.50.0')).toBe(1);
  });

  it('should compare complex versions like YouTube and Gboard', () => {
    expect(compareVersions('21.16.256', '21.15.34')).toBe(1);
    expect(compareVersions('18.0.3.954559732-release-arm64-v8a', '18.0.2.954559732-release-arm64-v8a')).toBe(1);
  });

  it('should sort versions descending', () => {
    const list = ['21.15.34', '21.16.256', '21.14.0', '21.16.255'];
    const sorted = sortVersionsDescending(list);
    expect(sorted).toEqual(['21.16.256', '21.16.255', '21.15.34', '21.14.0']);
  });
});
