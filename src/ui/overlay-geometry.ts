/** The part of a DOMRect the placement needs. */
export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface OverlayPlacement {
  visible: boolean;
  /** Distance from the top of the viewport to the top of the button. */
  top: number;
  /** Distance from the left of the viewport to the RIGHT edge of the button. */
  right: number;
}

/** Videos smaller than this are previews or icons, not worth a button. */
export const MIN_VIDEO_WIDTH = 120;
export const MIN_VIDEO_HEIGHT = 68;

const INSET = 8;
const HIDDEN: OverlayPlacement = { visible: false, top: 0, right: 0 };

/**
 * Where to put the button for a video: inside its top-right corner, kept inside
 * the viewport while the video is partly scrolled out. Hidden when the video is
 * too small, has no layout (display: none) or is fully outside the viewport.
 */
export function placeOverlay(video: Box, viewport: Viewport): OverlayPlacement {
  const width = video.right - video.left;
  const height = video.bottom - video.top;
  if (width < MIN_VIDEO_WIDTH || height < MIN_VIDEO_HEIGHT) {
    return HIDDEN;
  }

  const outside =
    video.bottom <= 0 || video.top >= viewport.height || video.right <= 0 || video.left >= viewport.width;
  if (outside) {
    return HIDDEN;
  }

  return {
    visible: true,
    top: Math.max(video.top, 0) + INSET,
    right: Math.min(video.right, viewport.width) - INSET,
  };
}
