import { describe, expect, it } from 'bun:test';
import { buildThemeStyle, cardVariantClass } from './FormThemeScope';
import type { FormTheme } from '@/types/form';

const theme = (over: Partial<FormTheme> = {}): FormTheme =>
  ({
    preset: 'slate',
    primaryColor: '#4f46e5',
    backgroundColor: '#f8fafc',
    cardColor: '#ffffff',
    textColor: '#18181b',
    fontFamily: 'Inter',
    borderRadius: 'md',
    cardVariant: 'card',
    ...over,
  }) as FormTheme;

const style = (t?: FormTheme) => buildThemeStyle(t) as unknown as Record<string, string>;

describe('buildThemeStyle', () => {
  it('maps the author-controlled colours onto the design tokens the runner uses', () => {
    const s = style(theme({ primaryColor: '#ff0000', cardColor: '#101010' }));
    expect(s['--primary']).toBe('#ff0000');
    expect(s['--card']).toBe('#101010');
    expect(s['--background']).toBe('#f8fafc');
  });

  it('picks a readable label colour for a light brand colour', () => {
    // The reason this is computed rather than fixed: white-on-yellow is
    // unreadable, and the colour picker makes yellow one click away.
    expect(style(theme({ primaryColor: '#ffff00' }))['--primary-foreground']).toBe('#111111');
    expect(style(theme({ primaryColor: '#101040' }))['--primary-foreground']).toBe('#ffffff');
  });

  it('derives borders from the text colour so a dark theme gets light borders', () => {
    const light = style(theme({ textColor: '#000000', cardColor: '#ffffff' }));
    const dark = style(theme({ textColor: '#ffffff', cardColor: '#000000' }));

    // Light theme: dark text over a white card gives a light grey border.
    expect(light['--border']).toBe('rgb(219, 219, 219)');
    // Dark theme: the same 14% mix now runs the other way.
    expect(dark['--border']).toBe('rgb(36, 36, 36)');
  });

  it('parses shorthand hex identically to the long form', () => {
    const short = style(theme({ textColor: '#000', cardColor: '#fff' }));
    const long = style(theme({ textColor: '#000000', cardColor: '#ffffff' }));
    expect(short['--border']).toBe(long['--border']);
    expect(short['--muted-foreground']).toBe(long['--muted-foreground']);

    // And a shorthand brand colour resolves the same way a full one does.
    expect(style(theme({ primaryColor: '#ff0' }))['--primary-foreground']).toBe(
      style(theme({ primaryColor: '#ffff00' }))['--primary-foreground'],
    );
  });

  it('parses the rgba() the glass preset ships', () => {
    // 'glass' has cardColor: 'rgba(255, 255, 255, 0.75)'. A parser that only
    // understood hex would fall back to defaults and lose the whole preset.
    const s = style(theme({ cardColor: 'rgba(255, 255, 255, 0.75)', textColor: '#000000' }));
    expect(s['--card']).toBe('rgba(255, 255, 255, 0.75)');
    expect(s['--border']).toBe('rgb(219, 219, 219)');
  });

  it('falls back to sane defaults for an empty theme rather than emitting undefined', () => {
    const s = style(undefined);
    expect(s['--primary']).toBeTruthy();
    expect(s['--foreground']).toBeTruthy();
    expect(s['--radius']).toBeTruthy();
    expect(s.fontFamily).toContain('Inter');
  });

  it('maps each radius choice to a distinct value', () => {
    const radii = (['none', 'sm', 'md', 'lg', 'full'] as const).map(
      (borderRadius) => style(theme({ borderRadius }))['--radius'],
    );
    expect(new Set(radii).size).toBe(5);
    expect(radii[0]).toBe('0rem');
  });

  it('selects the font stack for the chosen family', () => {
    expect(style(theme({ fontFamily: 'Outfit' })).fontFamily).toContain('--font-form-outfit');
    expect(style(theme({ fontFamily: 'Plus Jakarta Sans' })).fontFamily).toContain(
      '--font-form-jakarta',
    );
  });

  it('ignores an unparseable colour instead of throwing', () => {
    expect(() => style(theme({ primaryColor: 'not a colour' }))).not.toThrow();
    expect(style(theme({ primaryColor: 'not a colour' }))['--primary']).toBe('not a colour');
  });
});

describe('cardVariantClass', () => {
  it('gives each variant distinct chrome', () => {
    const variants = (['card', 'elevated', 'glass', 'minimal'] as const).map(cardVariantClass);
    expect(new Set(variants).size).toBe(4);
  });

  it('falls back to the bordered card for an unknown variant', () => {
    expect(cardVariantClass(undefined)).toBe(cardVariantClass('card'));
  });
});
