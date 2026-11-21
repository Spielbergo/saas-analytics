import "server-only";
import { kvGet, kvSet } from "./adminStore";
import { cleanExperiment, cleanNote, type Experiment } from "./experiments";

const KEY = "experiments";

export const listExperiments = () => kvGet<Experiment[]>(KEY, []);

type Action =
  | { action: "create"; experiment: unknown }
  | { action: "update"; id: string; experiment: unknown }
  | { action: "delete"; id: string }
  | { action: "addNote"; id: string; note: unknown }
  | { action: "deleteNote"; id: string; noteId: string };

export async function mutateExperiments(a: Action): Promise<Experiment[]> {
  const list = await listExperiments();
  switch (a.action) {
    case "create":
      if (list.length >= 100) throw new Error("Too many experiments — delete some first.");
      list.push(cleanExperiment(a.experiment));
      break;
    case "update": {
      const i = list.findIndex((x) => x.id === a.id);
      if (i < 0) throw new Error("Experiment not found.");
      list[i] = cleanExperiment({ ...list[i], ...(a.experiment as object) }, list[i]);
      break;
    }
    case "delete":
      return save(list.filter((x) => x.id !== a.id));
    case "addNote": {
      const x = list.find((e) => e.id === a.id);
      if (!x) throw new Error("Experiment not found.");
      if (x.notes.length >= 200) throw new Error("Too many notes on this experiment.");
      x.notes.push(cleanNote(a.note));
      x.notes.sort((p, q) => p.day.localeCompare(q.day));
      break;
    }
    case "deleteNote": {
      const x = list.find((e) => e.id === a.id);
      if (!x) throw new Error("Experiment not found.");
      x.notes = x.notes.filter((n) => n.id !== a.noteId);
      break;
    }
  }
  return save(list);
}

async function save(list: Experiment[]) {
  await kvSet(KEY, list);
  return list;
}
