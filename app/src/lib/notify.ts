import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { EventRow } from './types';
import { parseDate } from './format';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
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
}

/** Rebuilds scheduled local notifications from the current event set. */
export async function rescheduleNotifications(events: EventRow[]): Promise<number> {
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
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(time), channelId: 'family' },
        });
        scheduled += 1;
      }
    }
    return scheduled;
  } catch {
    return 0;
  }
}
