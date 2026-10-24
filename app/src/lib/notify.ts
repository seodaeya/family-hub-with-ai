import { Platform } from 'react-native';
import type { EventRow } from './types';
import { parseDate } from './format';

/**
 * Notifications are optional.
 *
 * `expo-notifications` needs native code. In Expo Go (especially Android) some
 * native modules are missing, and a top-level import crashes the whole app with
 * "Cannot find native module". So we load it lazily and degrade gracefully:
 * without it everything else works, only scheduled reminders are skipped.
 */
type NotificationsModule = typeof import('expo-notifications');

let loadPromise: Promise<NotificationsModule | null> | null = null;

function load(): Promise<NotificationsModule | null> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const mod = await import('expo-notifications');
        mod.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
        return mod;
      } catch {
        return null;
      }
    })();
  }
  return loadPromise;
}

/** False when the current runtime (e.g. Expo Go) has no notification support. */
export async function notificationsAvailable(): Promise<boolean> {
  return (await load()) !== null;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await load();
  if (!Notifications) return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('family', {
        name: '가족 일정',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
    }
    const request = await Notifications.requestPermissionsAsync();
    return request.granted;
  } catch {
    return false;
  }
}

/** Rebuilds scheduled local notifications from the current event set. */
export async function rescheduleNotifications(events: EventRow[]): Promise<number> {
  const Notifications = await load();
  if (!Notifications) return 0;

  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return 0;
    await Notifications.cancelAllScheduledNotificationsAsync();

    const now = Date.now();
    let scheduled = 0;
    for (const event of events) {
      const start = parseDate(event.startsAt);
      if (!start) continue;
      const startMs = start.getTime();
      if (startMs < now) continue;
      if (startMs - now > 90 * 86_400_000) continue;

      const dayBefore = new Date(start);
      dayBefore.setDate(dayBefore.getDate() - 1);
      dayBefore.setHours(20, 0, 0, 0);

      const candidates = [
        dayBefore.getTime(),
        event.allDay ? new Date(start).setHours(9, 0, 0, 0) : startMs - 30 * 60_000,
      ].filter((time) => time > now + 60_000);

      for (const time of candidates.slice(0, 2)) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: event.title,
            body: `가족 일정 · ${start.getMonth() + 1}월 ${start.getDate()}일`,
            data: { eventId: event.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(time),
            channelId: 'family',
          },
        });
        scheduled += 1;
      }
    }
    return scheduled;
  } catch {
    return 0;
  }
}
