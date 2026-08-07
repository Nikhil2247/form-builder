import { Inter, Outfit, Plus_Jakarta_Sans, Roboto } from 'next/font/google';

/**
 * The four families a form author can choose from in the theme panel.
 *
 * `FormTheme.fontFamily` has always been persisted and published, but nothing
 * loaded these faces — the app only ships Geist — so every public form rendered
 * in Geist regardless of the setting.
 *
 * Declaring all four is cheap: `next/font` self-hosts them and emits the
 * `@font-face` rules, but a browser only downloads a face that something on the
 * page actually renders in. A form using Outfit fetches Outfit and nothing else.
 */

export const formInter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-form-inter',
});

export const formRoboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-form-roboto',
});

export const formOutfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-form-outfit',
});

export const formJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-form-jakarta',
});

/** Applied to the public form wrapper so all four variables are in scope. */
export const formFontVariables = [
  formInter.variable,
  formRoboto.variable,
  formOutfit.variable,
  formJakarta.variable,
].join(' ');
