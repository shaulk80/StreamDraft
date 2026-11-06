import { describe, expect, test } from 'vitest';
import { placeOverlay, type Box, type Viewport } from '../../src/ui/overlay-geometry.ts';

const VIEWPORT: Viewport = { width: 1000, height: 800 };

function box(top: number, left: number, width: number, height: number): Box {
  return { top, left, right: left + width, bottom: top + height };
}

describe('placeOverlay', () => {
  test('puts the button inside the top-right corner of a visible video', () => {
    expect(placeOverlay(box(100, 50, 640, 360), VIEWPORT)).toEqual({ visible: true, top: 108, right: 682 });
  });

  test.each([
    ['partly above the viewport', box(-200, 50, 640, 360), 8, 682],
    ['wider than the viewport', box(100, 0, 1500, 360), 108, 992],
  ])('keeps the button inside the viewport when the video is %s', (_name, video, top, right) => {
    expect(placeOverlay(video, VIEWPORT)).toEqual({ visible: true, top, right });
  });

  test.each([
    ['too narrow', box(100, 50, 100, 360)],
    ['too short', box(100, 50, 640, 50)],
    ['without layout', box(0, 0, 0, 0)],
    ['above the viewport', box(-400, 50, 640, 360)],
    ['below the viewport', box(900, 50, 640, 360)],
    ['left of the viewport', box(100, -700, 640, 360)],
    ['right of the viewport', box(100, 1000, 640, 360)],
  ])('hides the button when the video is %s', (_name, video) => {
    expect(placeOverlay(video, VIEWPORT).visible).toBe(false);
  });
});
