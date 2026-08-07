import { redirect } from 'next/navigation';

/**
 * /settings has no content of its own.
 *
 * It previously rendered a "Profile" form pre-filled with "John Doe" and
 * "john@example.com" whose Save button was wired to nothing — a static mock
 * sitting on a real route. Personal details live at /profile; this index now
 * sends the user to the first real settings page.
 */
export default function SettingsIndexPage() {
  redirect('/settings/organization');
}
