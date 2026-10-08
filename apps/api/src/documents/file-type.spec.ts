import { LMS_TYPES, detectAllowedType, safeFileName } from './file-type.js';

const bytes = (...b: number[]) => Buffer.from([...b, 0, 0, 0, 0]);

describe('detectAllowedType', () => {
  it('accepts files whose content matches the extension', () => {
    expect(detectAllowedType('report.pdf', bytes(0x25, 0x50, 0x44, 0x46))).toBe('application/pdf');
    expect(detectAllowedType('photo.JPG', bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(detectAllowedType('scan.png', bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
  });

  it('accepts MP4 only where the caller allows it', () => {
    const mp4 = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(detectAllowedType('lesson.mp4', mp4)).toBeNull();
    expect(detectAllowedType('lesson.mp4', mp4, LMS_TYPES)).toBe('video/mp4');
  });

  it('rejects mismatched or disallowed files', () => {
    expect(detectAllowedType('evil.pdf', bytes(0x4d, 0x5a))).toBeNull(); // an .exe renamed to .pdf
    expect(detectAllowedType('page.html', Buffer.from('<html>'))).toBeNull();
    expect(detectAllowedType('noext', bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
  });
});

describe('safeFileName', () => {
  it('drops directories and unsafe characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\B-Form "copy".pdf')).toBe('B-Form _copy_.pdf');
    expect(safeFileName('')).toBe('file');
  });
});
