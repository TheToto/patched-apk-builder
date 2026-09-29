import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/loader.js';

describe('Config Loader', () => {
  it('should parse config.toml correctly', () => {
    const config = loadConfig('config.toml');
    expect(config.global).toBeDefined();
    expect(config.global.parallelJobs).toBeGreaterThanOrEqual(1);

    expect(config.apps['youtube']).toBeDefined();
    expect(config.apps['youtube'].name).toBe('YouTube');
    expect(config.apps['youtube'].enabled).toBe(true);
    expect(config.apps['youtube'].rvBrand).toBe('Morphe');
    expect(config.apps['youtube'].excludedPatches).toContain('Custom branding');
    expect(config.apps['youtube'].enableMicrog).toBe(true);

    expect(config.apps['music']).toBeDefined();
    expect(config.apps['music'].arch).toBe('both');
    expect(config.apps['music'].enableMicrog).toBe(true);

    expect(config.apps['niagaralauncher']).toBeDefined();
    expect(config.apps['niagaralauncher'].enableMicrog).toBe(false);

    expect(config.apps['reddit']).toBeDefined();
    expect(config.apps['reddit'].dpi).toBe('120-640dpi');
    expect(config.apps['reddit'].enableMicrog).toBe(false);
  });
});
