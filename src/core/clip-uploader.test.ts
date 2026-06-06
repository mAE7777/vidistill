import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClipInfo } from './splitter.js';

const mockUploadFile = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock('../gemini/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    uploadFile: mockUploadFile,
    deleteFile: mockDeleteFile,
  })),
}));

import { GeminiClient } from '../gemini/client.js';
import { uploadClips, deleteUploadedClips } from './clip-uploader.js';

function makeClip(index: number): ClipInfo {
  return {
    index,
    filePath: `/tmp/clip-${index}.mp4`,
    startTime: index * 1200,
    endTime: (index + 1) * 1200 + 30,
    overlapDuration: 30,
  };
}

describe('uploadClips', () => {
  let client: GeminiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GeminiClient('test-key');
    mockUploadFile.mockImplementation((path: string) =>
      Promise.resolve({
        uri: `gs://uploaded/${path}`,
        mimeType: 'video/mp4',
        name: `files/${path}`,
        duration: 1230,
      }),
    );
  });

  it('uploads all clips and returns UploadedClip array', async () => {
    const clips = [makeClip(0), makeClip(1), makeClip(2)];
    const fileNames: string[] = [];

    const result = await uploadClips(client, clips, fileNames);

    expect(result).toHaveLength(3);
    expect(mockUploadFile).toHaveBeenCalledTimes(3);
    expect(result[0].index).toBe(0);
    expect(result[1].globalStartTime).toBe(1200);
    expect(result[2].overlapDuration).toBe(30);
  });

  it('tracks file names incrementally — partial upload failure still records earlier files', async () => {
    mockUploadFile
      .mockResolvedValueOnce({ uri: 'gs://0', mimeType: 'video/mp4', name: 'files/0', duration: 1230 })
      .mockResolvedValueOnce({ uri: 'gs://1', mimeType: 'video/mp4', name: 'files/1', duration: 1230 })
      .mockRejectedValueOnce(new Error('upload failed'));

    const clips = [makeClip(0), makeClip(1), makeClip(2)];
    const fileNames: string[] = [];

    await expect(uploadClips(client, clips, fileNames)).rejects.toThrow('upload failed');

    // First two files were tracked before the third failed
    expect(fileNames).toEqual(['files/0', 'files/1']);
  });

  it('populates globalStartTime, globalEndTime, and clipDuration correctly', async () => {
    const clip: ClipInfo = {
      index: 3,
      filePath: '/tmp/clip-3.mp4',
      startTime: 3600,
      endTime: 4830,
      overlapDuration: 30,
    };
    const fileNames: string[] = [];

    const [result] = await uploadClips(client, [clip], fileNames);

    expect(result.globalStartTime).toBe(3600);
    expect(result.globalEndTime).toBe(4830);
    expect(result.clipDuration).toBe(1230);
  });
});

describe('deleteUploadedClips', () => {
  let client: GeminiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GeminiClient('test-key');
    mockDeleteFile.mockResolvedValue(undefined);
  });

  it('deletes all files', async () => {
    await deleteUploadedClips(client, ['files/0', 'files/1', 'files/2']);
    expect(mockDeleteFile).toHaveBeenCalledTimes(3);
    expect(mockDeleteFile).toHaveBeenCalledWith('files/0');
  });

  it('continues deleting even if one fails (best-effort)', async () => {
    mockDeleteFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined);

    await expect(deleteUploadedClips(client, ['a', 'b', 'c'])).resolves.not.toThrow();
    expect(mockDeleteFile).toHaveBeenCalledTimes(3);
  });

  it('handles empty array', async () => {
    await deleteUploadedClips(client, []);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});
