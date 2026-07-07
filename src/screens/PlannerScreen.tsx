// Planner — curb days, yard runs, sale dates, wire-stripping nights.
// The user's own entries with real local notifications (when permitted).

import { useState, useEffect } from "react";
import { Plus, X, Check, Bell, BellOff, Repeat, Calendar } from "lucide-react";
import {
  PlannerTask,
  WEEKDAYS,
  loadTasks,
  saveTasks,
  scheduleReminder,
  cancelReminder,
} from "../lib/planner";

type Mode = "none" | "date" | "weekly";

export default function PlannerScreen() {
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("none");
  const [due, setDue] = useState("");
  const [weekday, setWeekday] = useState(1); // Monday
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadTasks().then(setTasks);
  }, []);

  const persist = async (next: PlannerTask[]) => {
    setTasks(next);
    await saveTasks(next);
  };

  const addTask = async () => {
    const t = title.trim();
    if (!t) return;
    const task: PlannerTask = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: t,
      due: mode === "date" && due ? new Date(due).getTime() : undefined,
      recurringWeekday: mode === "weekly" ? weekday : undefined,
      done: false,
      createdAt: Date.now(),
    };
    task.notifId = await scheduleReminder(task);
    await persist([task, ...tasks]);
    setAdding(false);
    setTitle("");
    setDue("");
    setMode("none");
  };

  const toggleDone = async (id: string) => {
    const next = await Promise.all(
      tasks.map(async (t) => {
        if (t.id !== id) return t;
        const done = !t.done;
        if (done && t.notifId && t.recurringWeekday === undefined) {
          await cancelReminder(t.notifId);
          return { ...t, done, notifId: undefined };
        }
        return { ...t, done };
      })
    );
    await persist(next);
  };

  const deleteTask = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (task?.notifId) await cancelReminder(task.notifId);
    await persist(tasks.filter((t) => t.id !== id));
    setConfirmDelete(null);
  };

  // Grouping
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const weekOut = now + 7 * 24 * 60 * 60 * 1000;
  const open = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);
  const groups: Array<{ name: string; items: PlannerTask[] }> = [
    { name: "EVERY WEEK", items: open.filter((t) => t.recurringWeekday !== undefined) },
    { name: "OVERDUE", items: open.filter((t) => t.due !== undefined && t.due < now) },
    { name: "TODAY", items: open.filter((t) => t.due !== undefined && t.due >= now && t.due <= endOfToday.getTime()) },
    { name: "THIS WEEK", items: open.filter((t) => t.due !== undefined && t.due > endOfToday.getTime() && t.due <= weekOut) },
    { name: "LATER", items: open.filter((t) => t.due !== undefined && t.due > weekOut) },
    { name: "WHENEVER", items: open.filter((t) => t.due === undefined && t.recurringWeekday === undefined) },
  ].filter((g) => g.items.length > 0);

  const describe = (t: PlannerTask): string => {
    if (t.recurringWeekday !== undefined) return `${WEEKDAYS[t.recurringWeekday]}s · reminds 7:00 AM`;
    if (t.due) return new Date(t.due).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return "no date";
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
      <div className="text-sm text-faint">
        Curb day, yard runs, sales to hit, wire to strip. Reminders ring when you allow
        notifications — the list works either way.
      </div>

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-3.5 rounded-xl term-font font-extrabold text-base flex items-center justify-center gap-2"
          style={{ background: "#4ADE80", color: "#0A0E1A" }}
        >
          <Plus size={17} /> ADD TO THE PLAN
        </button>
      ) : (
        <div className="bg-panel border border-edge rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="term-font text-[10px] tracking-widest text-faint">NEW ENTRY</div>
            <button onClick={() => setAdding(false)} aria-label="Cancel">
              <X size={16} color="#7A8494" />
            </button>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Bulk trash on Maple St / strip the wire pile"
            className="w-full bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout"
          />
          <div className="flex gap-1.5">
            {(
              [
                { m: "none", label: "No date" },
                { m: "date", label: "Pick a time" },
                { m: "weekly", label: "Every week" },
              ] as Array<{ m: Mode; label: string }>
            ).map(({ m, label }) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="px-3 py-1.5 rounded-full text-[11px] border"
                style={mode === m ? { borderColor: "#4ADE80", color: "#4ADE80" } : { borderColor: "#1F2937", color: "#7A8494" }}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "date" && (
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout"
            />
          )}
          {mode === "weekly" && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setWeekday(i)}
                  className="px-2.5 py-1.5 rounded-full text-[11px] border"
                  style={weekday === i ? { borderColor: "#4ADE80", color: "#4ADE80" } : { borderColor: "#1F2937", color: "#7A8494" }}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={addTask}
            disabled={!title.trim() || (mode === "date" && !due)}
            className="w-full py-3 rounded-xl term-font font-bold text-sm disabled:opacity-40"
            style={{ background: "#4ADE80", color: "#0A0E1A" }}
          >
            SAVE IT
          </button>
        </div>
      )}

      {tasks.length === 0 && !adding && (
        <div className="bg-panel border border-edge rounded-xl p-5 text-sm text-faint">
          Empty plan. Start with your town's bulk-trash day — it's the single most reliable free
          inventory of the month.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.name}>
          <div className="term-font text-[10px] tracking-widest text-faint mb-2">{g.name}</div>
          <div className="flex flex-col gap-2">
            {g.items.map((t) => (
              <div key={t.id} className="bg-panel border border-edge rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleDone(t.id)}
                    className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: "#4ADE80" }}
                    aria-label="Done"
                  >
                    {t.done && <Check size={14} color="#4ADE80" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white font-medium truncate">{t.title}</div>
                    <div className="text-xs text-faint mt-0.5 flex items-center gap-1.5">
                      {t.recurringWeekday !== undefined ? <Repeat size={10} /> : t.due ? <Calendar size={10} /> : null}
                      {describe(t)}
                      {t.notifId ? <Bell size={10} color="#4ADE80" /> : <BellOff size={10} />}
                    </div>
                  </div>
                  {confirmDelete === t.id ? (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => deleteTask(t.id)}
                        className="px-2.5 py-1.5 rounded text-[11px] font-bold"
                        style={{ background: "#F87171", color: "#0A0E1A" }}
                      >
                        Remove
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1.5 rounded text-[11px] border border-edge text-mist">
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(t.id)} className="p-1 flex-shrink-0" aria-label={`Remove ${t.title}`}>
                      <X size={15} color="#7A8494" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {doneTasks.length > 0 && (
        <div>
          <div className="term-font text-[10px] tracking-widest text-faint mb-2">DONE</div>
          <div className="flex flex-col gap-2">
            {doneTasks.slice(0, 10).map((t) => (
              <div key={t.id} className="bg-panel border border-edge rounded-xl px-4 py-2.5 flex items-center gap-3 opacity-60">
                <button
                  onClick={() => toggleDone(t.id)}
                  className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: "#4ADE80", background: "rgba(74,222,128,0.15)" }}
                  aria-label="Undo"
                >
                  <Check size={14} color="#4ADE80" />
                </button>
                <span className="text-sm text-faint line-through truncate flex-1">{t.title}</span>
                <button onClick={() => deleteTask(t.id)} className="p-1" aria-label={`Remove ${t.title}`}>
                  <X size={14} color="#7A8494" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pb-3" />
    </div>
  );
}
