import { describe, it, expect } from 'vitest';
import { viewAsOverlayApplies, type ViewAsOverlay } from '@/server/capabilities';

const mk = (o: Partial<ViewAsOverlay>): ViewAsOverlay => ({
  sub: 'p1',
  rr: ['super_admin', 'admin'],
  roles: ['staff'],
  ...o,
});

describe('viewAsOverlayApplies', () => {
  it('applies a well-formed overlay for the same person with unchanged real roles', () => {
    expect(viewAsOverlayApplies(mk({}), 'p1', ['super_admin', 'admin'])).toBe(true);
  });

  it('is order-insensitive on the real-role snapshot', () => {
    expect(viewAsOverlayApplies(mk({ rr: ['admin', 'super_admin'] }), 'p1', ['super_admin', 'admin'])).toBe(true);
  });

  it('drops a null overlay (no cookie / malformed)', () => {
    expect(viewAsOverlayApplies(null, 'p1', ['admin'])).toBe(false);
  });

  it("drops another person's leftover overlay", () => {
    expect(viewAsOverlayApplies(mk({ sub: 'someone-else' }), 'p1', ['super_admin', 'admin'])).toBe(false);
  });

  // The Jas Navarro incident: an admin previewed `staff`, then had their
  // real roles changed in the platform. The stale overlay must NOT keep
  // pinning them to staff — the snapshot no longer matches current roles.
  it('drops the overlay once the real roles change (grant/revoke in platform)', () => {
    const stale = mk({ rr: ['staff'], roles: ['staff'] }); // set while they were staff
    // roles later upgraded to admin in the platform:
    expect(viewAsOverlayApplies(stale, 'p1', ['admin'])).toBe(false);
  });

  it('drops an overlay that would not be a strict downgrade (escalation guard)', () => {
    // Real roles are staff; overlay claims admin → not a downgrade.
    const escalating = mk({ sub: 'p1', rr: ['staff'], roles: ['admin'] });
    expect(viewAsOverlayApplies(escalating, 'p1', ['staff'])).toBe(false);
  });
});
