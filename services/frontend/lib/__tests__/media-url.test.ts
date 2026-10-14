import { afterEach, describe, expect, it } from 'vitest';
import { getMediaUrl } from '../api';

const original = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = original;
});

describe('getMediaUrl', () => {
  it('returns null without a key', () => {
    expect(getMediaUrl(null)).toBeNull();
  });

  it('returns a relative /media path by default', () => {
    expect(getMediaUrl('media/ab/cd/x.jpg')).toBe('/media/ab/cd/x.jpg');
    expect(getMediaUrl('/media/ab/cd/x.jpg')).toBe('/media/ab/cd/x.jpg');
  });

  it('returns an absolute URL on NEXT_PUBLIC_BASE_URL for OpenGraph', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://archive.example.org/';
    expect(getMediaUrl('media/ab/cd/x.jpg', true)).toBe(
      'https://archive.example.org/media/ab/cd/x.jpg',
    );
  });

  it('falls back to http://localhost when NEXT_PUBLIC_BASE_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(getMediaUrl('media/ab/cd/x.jpg', true)).toBe('http://localhost/media/ab/cd/x.jpg');
  });
});
