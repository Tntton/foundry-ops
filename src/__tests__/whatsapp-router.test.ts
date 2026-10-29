import { describe, it, expect } from 'vitest';
import { unknownSenderReply } from '@/server/integrations/whatsapp-router';

describe('unknownSenderReply', () => {
  const msg = unknownSenderReply();

  it('tells the sender we could not match the number', () => {
    expect(msg.toLowerCase()).toContain("don't recognise this number");
  });

  it('points a real teammate at the fix (admin adds the number in the Directory)', () => {
    expect(msg.toLowerCase()).toContain('admin');
    expect(msg.toLowerCase()).toContain('directory');
  });

  it('nudges the E.164 format so the re-registered number actually matches', () => {
    expect(msg).toContain('+61');
  });

  it('does not leak whether any specific person is registered', () => {
    // Generic copy only — no names, emails, or "you are not registered"
    // that would confirm the number belongs to a known-but-unlinked person.
    expect(msg).not.toMatch(/@foundry\.health/);
  });
});
