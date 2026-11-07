import { describe, expect, test } from 'vitest';
import { protectionName } from '../../src/formats/drm.ts';

describe('protectionName', () => {
  test.each([
    ['urn:uuid:EDEF8BA9-79D6-4ACE-A3C8-27DCD51D21ED', 'Widevine DRM'],
    ['urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95', 'PlayReady DRM'],
    ['com.microsoft.playready', 'PlayReady DRM'],
    ['com.apple.streamingkeydelivery', 'FairPlay DRM'],
    ['urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e', 'ClearKey encryption'],
  ])('%s is %s', (identifier, expected) => {
    expect(protectionName(identifier)).toBe(expected);
  });

  test('gives undefined for a scheme it does not know', () => {
    expect(protectionName('urn:mpeg:dash:mp4protection:2011')).toBeUndefined();
  });
});
