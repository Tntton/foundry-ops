import { describe, it, expect } from 'vitest';
import config from '../../tailwind.config';

describe('Tailwind design tokens (from hifi.css)', () => {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;
  const radii = (config.theme?.extend?.borderRadius ?? {}) as Record<string, string>;
  const shadows = (config.theme?.extend?.boxShadow ?? {}) as Record<string, string>;
  const fonts = (config.theme?.extend?.fontFamily ?? {}) as Record<string, string[]>;

  it('brand alias present and uses the --brand CSS var (hifi.css #688b71)', () => {
    const brand = colors['brand'] as Record<string, string>;
    expect(brand.DEFAULT).toBe('var(--brand)');
    expect(brand['ink']).toBe('var(--brand-ink)');
    expect(brand['soft']).toBe('var(--brand-soft)');
  });

  it('status colors (green / amber / red / blue) aliased', () => {
    const status = colors['status'] as Record<string, Record<string, string>>;
    expect(status.green?.DEFAULT).toBe('var(--status-green)');
    expect(status.amber?.DEFAULT).toBe('var(--status-amber)');
    expect(status.red?.DEFAULT).toBe('var(--status-red)');
    expect(status.blue?.DEFAULT).toBe('var(--status-blue)');
  });

  it('radius tokens match hifi.css (6 / 8 / 12 / 16 px)', () => {
    expect(radii['sm']).toBe('6px');
    expect(radii['DEFAULT']).toBe('8px');
    expect(radii['lg']).toBe('12px');
    expect(radii['xl']).toBe('16px');
  });

  it('shadows match the three hifi.css elevations', () => {
    expect(shadows['sm']).toContain('rgba(15,20,25,.04)');
    expect(shadows['lg']).toContain('0 6px 24px');
  });

  it('primary shadcn alias maps to Foundry brand via --primary', () => {
    const primary = colors['primary'] as Record<string, string>;
    expect(primary.DEFAULT).toBe('var(--primary)');
  });

  it('font-sans / font-mono stacks defined', () => {
    expect(fonts['sans']?.[0]).toBe('Helvetica Neue');
    expect(fonts['mono']?.[0]).toBe('JetBrains Mono');
  });
});
