import { downloadFilename, type MediaItem, type QualityOption } from '../../core/media.ts';
import { fail, ok, type Result } from '../../core/result.ts';
import type { Settings } from '../../core/settings.ts';
import type { RecordingInput } from '../../engine/recording-input.ts';
import type { StreamStarter } from '../../engine/job-coordinator.ts';
import type { CaptureSnapshot } from './types.ts';

/** What the background can ask of the page that is being recorded. */
export interface CapturePages {
  /** Marks the tab's next load for recording. */
  arm(tabId: number): Promise<Result<void>>;
  reload(tabId: number): Promise<Result<void>>;
  status(tabId: number): Promise<Result<CaptureSnapshot>>;
  save(tabId: number): Promise<Result<RecordingInput>>;
  discard(tabId: number): Promise<Result<void>>;
}

export interface TabDetails {
  url?: string;
  title?: string;
}

export interface CaptureServiceDeps {
  pages: CapturePages;
  /** Starts the engine job that joins a recording. */
  streams: StreamStarter;
  tab(tabId: number): Promise<TabDetails | undefined>;
  loadSettings(): Promise<Settings>;
  /** Today as `YYYY-MM-DD`, for the {date} placeholder. */
  today(): string;
}

export interface StartedCapture {
  filename: string;
  jobId: string;
}

const NO_SETTING = 'The player capture is switched off. Switch it on in the options first.';
const BEST: QualityOption = { quality: 'best', label: 'Recording' };
const SOUND: QualityOption = { quality: 'audio', label: 'Audio only' };

function siteOf(url: string | undefined): string {
  if (url === undefined || !URL.canParse(url)) {
    return 'unknown';
  }
  return new URL(url).hostname.replace(/^www\./, '');
}

/** The video of a recording as an item, so a job can be named, listed and followed like any other. */
function itemOf(tabId: number, details: TabDetails | undefined): MediaItem {
  const url = details?.url ?? '';
  const title = details?.title?.trim() ?? '';
  return {
    id: `capture:${tabId}`,
    url,
    title: title === '' ? siteOf(url) : title,
    site: siteOf(url),
    kind: 'capture',
    container: 'mp4',
    qualities: [BEST, SOUND],
    protected: false,
  };
}

/**
 * The player capture as the background runs it: arming a tab, reading how its
 * recording stands, and joining the finished recording through the engine.
 */
export class CaptureService {
  constructor(private readonly deps: CaptureServiceDeps) {}

  /** Marks the tab for recording and reloads it, so the hook is in place before the player's first byte. */
  async arm(tabId: number): Promise<Result<void>> {
    const settings = await this.deps.loadSettings();
    if (!settings.playerCapture) {
      return fail(NO_SETTING);
    }

    const armed = await this.deps.pages.arm(tabId);
    return armed.ok ? this.deps.pages.reload(tabId) : armed;
  }

  status(tabId: number): Promise<Result<CaptureSnapshot>> {
    return this.deps.pages.status(tabId);
  }

  discard(tabId: number): Promise<Result<void>> {
    return this.deps.pages.discard(tabId);
  }

  /** Joins the finished recording of the tab into a file and saves it, with or without the picture. */
  async save(tabId: number, soundOnly: boolean): Promise<Result<StartedCapture>> {
    const recording = await this.deps.pages.save(tabId);
    if (!recording.ok) {
      return recording;
    }

    const [settings, details] = await Promise.all([this.deps.loadSettings(), this.deps.tab(tabId)]);
    const item = itemOf(tabId, details);
    const option = soundOnly ? SOUND : BEST;
    const filename = downloadFilename(item, option, settings.filenameTemplate, this.deps.today());
    const started = await this.deps.streams.start({ item, option, filename, recording: recording.value });
    return started.ok ? ok({ filename, jobId: started.value.jobId }) : started;
  }
}
