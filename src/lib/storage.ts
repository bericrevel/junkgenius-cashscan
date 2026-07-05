import { Preferences } from "@capacitor/preferences";

export async function getItem(key: string): Promise<string | null> {
  const res = await Preferences.get({ key });
  return res.value;
}

export async function setItem(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}

export async function removeItem(key: string): Promise<void> {
  await Preferences.remove({ key });
}
