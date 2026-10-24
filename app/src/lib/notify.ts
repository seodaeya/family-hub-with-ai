import type { EventRow } from './types';

/**
 * Local reminders are intentionally disabled in this build.
 *
 * Expo Go on Android ships without the `ExpoTopicSubscriptionModule` native
 * module that `expo-notifications` needs, and importing the package (even
 * lazily, through `import()`) still crashes the app at startup with
 * "Cannot find native module 'ExpoTopicSubscriptionModule'".
 *
 * Everything else in the app works without it. To turn reminders back on:
 *
 *   1. npx expo install expo-notifications
 *   2. build a development client (npx expo run:android / eas build)
 *   3. restore the implementation from git history (commit 2738cab)
 *
 * Keep this module free of any top-level `expo-notifications` import.
 */

const REMINDERS_ENABLED = false;

/** False while reminders are disabled, so the UI can explain why. */
export async function notificationsAvailable(): Promise<boolean> {
  return REMINDERS_ENABLED;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  return false;
}

export async function rescheduleNotifications(events: EventRow[]): Promise<number> {
  // No-op: schedules nothing. Signature kept so callers stay unchanged.
  void events;
  return 0;
}
