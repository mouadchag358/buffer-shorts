import test from 'node:test';
import assert from 'node:assert/strict';
import { publicVideoUrl } from '../src/diagnose-r2-file.js';

test('R2 public URL encodes literal percent signs and Unicode path segments', () => {
  const key = '%_的现场表演。以独特时尚造型_%_2026-10-04_test%.mp4';
  const url = new URL(publicVideoUrl('https://media.example.com/', key));
  assert.equal(url.origin, 'https://media.example.com');
  assert.equal(url.pathname, '/' + key.split('/').map(encodeURIComponent).join('/'));
  assert.equal(decodeURIComponent(url.pathname.slice(1)), key);
});

test('R2 public URL preserves object key directories', () => {
  const key = 'folder with spaces/clip #1%.mp4';
  const url = new URL(publicVideoUrl('https://media.example.com', key));
  assert.equal(url.pathname, '/' + key.split('/').map(encodeURIComponent).join('/'));
  assert.equal(decodeURIComponent(url.pathname.slice(1)), key);
});
