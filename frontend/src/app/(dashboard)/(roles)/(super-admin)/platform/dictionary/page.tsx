'use client';

import { DictionaryPage } from '@/components/dictionary/DictionaryPage';

/**
 * The platform's global dictionary.
 *
 * Lists here have no owning organization, which makes them readable by every
 * tenant and writable only from this page. India's states and districts ship
 * this way; anything every tenant would otherwise upload separately belongs
 * here too.
 */
export default function PlatformDictionaryPage() {
  return <DictionaryPage scope="platform" />;
}
