import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      mkdir: mockMkdir,
    },
  };
});

vi.mock('@clack/prompts', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  password: vi.fn(),
  confirm: vi.fn(),
}));

import { loadConfig, saveConfig } from './config.js';

afterEach(() => {
  vi.resetAllMocks();
});

describe('loadConfig', () => {
  it('returns parsed config when file contains valid JSON with string apiKey', async () => {
    mockReadFile.mockResolvedValue('{"apiKey": "test-key-123"}');
    const config = await loadConfig();
    expect(config).toEqual({ apiKey: 'test-key-123' });
  });

  it('returns null when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('returns null when file contains invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not json');
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('returns null when apiKey is not a string', async () => {
    mockReadFile.mockResolvedValue('{"apiKey": 123}');
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('returns null when JSON is an array', async () => {
    mockReadFile.mockResolvedValue('[1, 2, 3]');
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('returns config when apiKey is undefined', async () => {
    mockReadFile.mockResolvedValue('{"defaultOutputDir": "./out"}');
    const config = await loadConfig();
    expect(config).toEqual({ defaultOutputDir: './out' });
  });
});

describe('saveConfig', () => {
  it('creates config directory with mode 0o700', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await saveConfig({ apiKey: 'test-key' });

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('.vidistill'),
      { recursive: true, mode: 0o700 },
    );
  });

  it('writes config file with mode 0o600', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await saveConfig({ apiKey: 'test-key' });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      JSON.stringify({ apiKey: 'test-key' }, null, 2),
      { encoding: 'utf-8', mode: 0o600 },
    );
  });
});
