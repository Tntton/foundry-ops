import { describe, it, expect } from 'vitest';
import { OpenIn365 } from '@/components/sharepoint-link';

/**
 * TASK-069d · the OpenIn365 link. The component is a pure function of its
 * props, so we can call it directly and inspect the returned element tree
 * without a DOM — renders nothing on an empty url, a correct external
 * anchor on a valid one.
 */

type El = { props: Record<string, unknown> } | null;

describe('OpenIn365', () => {
  it('renders nothing when the url is missing', () => {
    expect(OpenIn365({ url: null }) as El).toBeNull();
    expect(OpenIn365({ url: undefined }) as El).toBeNull();
    expect(OpenIn365({ url: '' }) as El).toBeNull();
  });

  it('renders a new-tab external anchor for a valid url', () => {
    const el = OpenIn365({ url: 'https://foundry.sharepoint.com/x.pdf' }) as El;
    expect(el).not.toBeNull();
    expect(el!.props.href).toBe('https://foundry.sharepoint.com/x.pdf');
    expect(el!.props.target).toBe('_blank');
    expect(String(el!.props.rel)).toContain('noopener');
  });

  it('honours a custom label', () => {
    const el = OpenIn365({ url: 'https://sp/x', label: 'Project folder' }) as El;
    const children = el!.props.children as unknown[];
    expect(children).toContain('Project folder');
  });
});
