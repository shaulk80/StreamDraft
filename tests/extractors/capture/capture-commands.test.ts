import { describe, expect, test } from 'vitest';
import { ok } from '../../../src/core/result.ts';
import {
  captureCommandMessage,
  pageRequestMessage,
  parseCaptureCommandMessage,
  parsePageRequestMessage,
  type CaptureCommand,
} from '../../../src/extractors/capture/capture-commands.ts';

describe('capture commands', () => {
  test.each<[string, CaptureCommand]>([
    ['arm', { kind: 'arm', tabId: 7 }],
    ['status', { kind: 'status', tabId: 7 }],
    ['save with the picture', { kind: 'save', tabId: 7, soundOnly: false }],
    ['save sound only', { kind: 'save', tabId: 7, soundOnly: true }],
    ['discard', { kind: 'discard', tabId: 7 }],
  ])('a %s command survives the trip', (_name, command) => {
    expect(parseCaptureCommandMessage(JSON.parse(JSON.stringify(captureCommandMessage(command))))).toEqual(ok(command));
  });

  test('a save that does not say sound only wants the picture too', () => {
    const parsed = parseCaptureCommandMessage({ type: 'capture-command', command: { kind: 'save', tabId: 1 } });

    expect(parsed).toEqual(ok({ kind: 'save', tabId: 1, soundOnly: false }));
  });

  test.each<[string, unknown]>([
    ['nothing', undefined],
    ['text', 'arm'],
    ['another message', { type: 'ping' }],
    ['no command', { type: 'capture-command' }],
    ['no tab', { type: 'capture-command', command: { kind: 'arm' } }],
    ['a tab that is not a whole number', { type: 'capture-command', command: { kind: 'arm', tabId: 1.5 } }],
    ['a tab named by text', { type: 'capture-command', command: { kind: 'arm', tabId: '7' } }],
    ['an unknown command', { type: 'capture-command', command: { kind: 'format', tabId: 7 } }],
  ])('refuses %s', (_name, message) => {
    expect(parseCaptureCommandMessage(message).ok).toBe(false);
  });
});

describe('capture page requests', () => {
  test.each(['status', 'save', 'discard'] as const)('a %s request survives the trip', (request) => {
    expect(parsePageRequestMessage(JSON.parse(JSON.stringify(pageRequestMessage(request))))).toEqual(ok(request));
  });

  test.each<[string, unknown]>([
    ['nothing', undefined],
    ['another message', { type: 'ping' }],
    ['an unknown request', { type: 'capture-page-request', request: 'format' }],
    ['no request', { type: 'capture-page-request' }],
  ])('refuses %s', (_name, message) => {
    expect(parsePageRequestMessage(message).ok).toBe(false);
  });
});
