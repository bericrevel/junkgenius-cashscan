// Planner — tasks, curb-day reminders, sale dates. All the user's own real
// entries, all on-device. Real notifications via Capacitor LocalNotifications
// when permission is granted; the list still works fully without it (honest
// degradation, never a nagging wall).

import { LocalNotifications } from "@capacitor/local-notifications";
import { getItem, setItem } from "./storage";

export interface PlannerTask {
  id: string;
  title: string;
  /** One-shot due time (ms). Mutually exclusive with recurringWeekday. */
  due?: number;
  /** 0=Sunday … 6=Saturday — repeats weekly (curb day, yard run day). */
  recurringWeekday?: number;
  done: boolean;
  createdAt: number;
  notifId?: number;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const KEY = "junkgenius:tasks";

export async function loadTasks(): Promise<PlannerTask[]> {
  const raw = await getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PlannerTask[]) : [];
  } catch {
    return [];
  }
}

export async function saveTasks(tasks: PlannerTask[]): Promise<void> {
  await setItem(KEY, JSON.stringify(tasks));
}

/**
 * Best-effort reminder. Returns the notification id, or undefined when
 * permission is denied / unavailable (web dev) — the task itself still saves.
 * Recurring tasks ring at 7:00 AM on their weekday; dated tasks at their time.
 */
export async function scheduleReminder(task: PlannerTask): Promise<number | undefined> {
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return undefined;
    const id = Math.floor(Math.random() * 2_000_000_000);
    if (task.recurringWeekday !== undefined) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: "JunkGenius",
            body: task.title,
            schedule: {
              // Capacitor convention: weekday 1 = Sunday … 7 = Saturday
              on: { weekday: task.recurringWeekday + 1, hour: 7, minute: 0 },
              allowWhileIdle: true,
            },
          },
        ],
      });
      return id;
    }
    if (task.due && task.due > Date.now()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: "JunkGenius",
            body: task.title,
            schedule: { at: new Date(task.due), allowWhileIdle: true },
          },
        ],
      });
      return id;
    }
    return undefined;
  } catch {
    return undefined; // web dev / plugin unavailable — task still works
  }
}

export async function cancelReminder(notifId?: number): Promise<void> {
  if (!notifId) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
  } catch {
    /* nothing to cancel on web */
  }
}
