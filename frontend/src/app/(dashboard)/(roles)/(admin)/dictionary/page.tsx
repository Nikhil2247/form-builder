'use client';

import { DictionaryPage } from '@/components/dictionary/DictionaryPage';

/**
 * This organization's option lists.
 *
 * Shows the platform's global lists alongside them, read-only, so an admin can
 * see that `in-districts` already exists before uploading their own copy of it.
 * The layout above gates on `org:manage`; the API re-checks with EDITOR for
 * writes and ADMIN for deletes.
 */
export default function OrgDictionaryPage() {
  return <DictionaryPage scope="org" />;
}
