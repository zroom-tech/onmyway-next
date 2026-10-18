// 테스트·로컬 확인용 메모리 저장소
import type { Slot } from "./slot";
import { distanceM } from "./geo";
import type { Crosswalk, NewCrosswalk, PrivateCrosswalk, ReportKind, SanctionScope, SharedCrosswalk, SignalRepo, StoredRecord, UserSignal } from "./repo";
import type { GroupSlotState } from "./types";

const key = (groupId: string, slot: Slot) => `${groupId}|${slot.dayType}|${slot.hour}`;

export class MemoryRepo implements SignalRepo {
  crosswalks = new Map<string, Crosswalk>();
  states = new Map<string, GroupSlotState>();
  records: StoredRecord[] = [];
  userSignals = new Map<string, UserSignal[]>();
  sanctions: { userId: string; scope: SanctionScope; until: number }[] = [];
  holidaySet = new Set<string>();
  registrationsToday = new Map<string, number>();
  reports: { crosswalkId: string; groupId: string; userId: string; kind: ReportKind; reportDate: string; status: string }[] = [];
  private seq = 0;
  private id = (p: string) => `${p}${++this.seq}`;

  async getCrosswalk(id: string) {
    return this.crosswalks.get(id) ?? null;
  }
  async listCrosswalks(q: { ids?: string[]; bbox?: [number, number, number, number] }) {
    const all = [...this.crosswalks.values()];
    if (q.ids) return all.filter((c) => q.ids!.includes(c.id));
    if (q.bbox) {
      const [minLng, minLat, maxLng, maxLat] = q.bbox;
      return this.shared().filter((c) => {
        const lng = (c.endA[0] + c.endB[0]) / 2;
        const lat = (c.endA[1] + c.endB[1]) / 2;
        return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
      });
    }
    return all;
  }
  async getState(groupId: string, slot: Slot) {
    return this.states.get(key(groupId, slot)) ?? null;
  }
  async saveState(groupId: string, slot: Slot, state: GroupSlotState) {
    this.states.set(key(groupId, slot), state);
  }
  async insertRecord(r: StoredRecord) {
    this.records.push(r);
  }
  async latestRecordOf(userId: string, groupId: string, slot: Slot) {
    const mine = this.records
      .filter((r) => r.user === userId && r.groupId === groupId && key(groupId, r.slot) === key(groupId, slot))
      .sort((a, b) => b.at - a.at);
    return mine[0] ?? null;
  }
  async countRecordsBySlot(groupId: string, slot: Slot) {
    return this.records.filter((r) => r.groupId === groupId && key(groupId, r.slot) === key(groupId, slot)).length;
  }
  async listUserSignals(userId: string) {
    return this.userSignals.get(userId) ?? [];
  }
  async upsertUserSignal(userId: string, crosswalkId: string) {
    const list = this.userSignals.get(userId) ?? [];
    if (!list.some((s) => s.crosswalkId === crosswalkId)) list.push({ crosswalkId, alias: null, showAggregate: false, autoSwitched: false });
    this.userSignals.set(userId, list);
  }
  async isSanctioned(userId: string, scope: SanctionScope, at: number) {
    return this.sanctions.some((s) => s.userId === userId && s.scope === scope && s.until > at);
  }
  async holidays() {
    return this.holidaySet;
  }

  private shared(): SharedCrosswalk[] {
    return [...this.crosswalks.values()].filter((c): c is SharedCrosswalk => !c.isPrivate);
  }

  async findCrosswalksNear(point: [number, number], radiusM: number) {
    const mid = (c: SharedCrosswalk): [number, number] => [(c.endA[0] + c.endB[0]) / 2, (c.endA[1] + c.endB[1]) / 2];
    return this.shared()
      .filter((c) => distanceM(point, mid(c)) <= radiusM)
      .sort((a, b) => distanceM(point, mid(a)) - distanceM(point, mid(b)));
  }
  async listIntersectionCrosswalks(intersectionId: string) {
    return this.shared().filter((c) => c.intersectionId === intersectionId);
  }
  async createIntersection() {
    return this.id("I");
  }
  async createGroup() {
    return this.id("G");
  }
  async createCrosswalk(c: NewCrosswalk) {
    const cw: SharedCrosswalk = { ...c, id: this.id("C"), isPrivate: false, buttonMarks: [] };
    this.crosswalks.set(cw.id, cw);
    this.registrationsToday.set(c.createdBy, (this.registrationsToday.get(c.createdBy) ?? 0) + 1);
    return cw;
  }
  async createPrivateCrosswalk(groupId: string, createdBy: string) {
    const cw: PrivateCrosswalk = { id: this.id("P"), groupId, createdBy, isPrivate: true, intersectionId: null, sharedName: null, endA: null, endB: null, buttonMarks: [] };
    this.crosswalks.set(cw.id, cw);
    this.registrationsToday.set(createdBy, (this.registrationsToday.get(createdBy) ?? 0) + 1);
    return cw;
  }
  async listCrosswalkRecords(crosswalkId: string) {
    return this.records.filter((r) => r.crosswalkId === crosswalkId).sort((a, b) => a.at - b.at);
  }
  async deletePrivateCrosswalk(crosswalkId: string) {
    const cw = this.crosswalks.get(crosswalkId);
    if (!cw?.isPrivate) return;
    this.records = this.records.filter((r) => r.crosswalkId !== crosswalkId);
    this.reports = this.reports.filter((r) => r.crosswalkId !== crosswalkId);
    for (const [u, list] of this.userSignals) this.userSignals.set(u, list.filter((s) => s.crosswalkId !== crosswalkId));
    for (const k of [...this.states.keys()]) if (k.startsWith(`${cw.groupId}|`)) this.states.delete(k);
    this.crosswalks.delete(crosswalkId);
  }
  async setCrosswalkGroup(ids: string[], groupId: string) {
    for (const id of ids) {
      const c = this.crosswalks.get(id);
      if (c) this.crosswalks.set(id, { ...c, groupId });
    }
  }
  async countRegistrationsOn(userId: string) {
    return this.registrationsToday.get(userId) ?? 0;
  }
  async addButtonMark(groupId: string, userId: string) {
    for (const [id, c] of this.crosswalks) {
      if (c.groupId === groupId && !c.buttonMarks.includes(userId)) this.crosswalks.set(id, { ...c, buttonMarks: [...c.buttonMarks, userId] });
    }
  }
  async insertReport(r: { crosswalkId: string; groupId: string; userId: string; kind: ReportKind; reportDate: string; status: "open" | "auto" }) {
    if (this.reports.some((x) => x.groupId === r.groupId && x.userId === r.userId && x.reportDate === r.reportDate)) return false;
    this.reports.push(r);
    return true;
  }
  async removeUserSignal(userId: string, crosswalkId: string) {
    this.userSignals.set(userId, (this.userSignals.get(userId) ?? []).filter((s) => s.crosswalkId !== crosswalkId));
  }
  async updateUserSignal(userId: string, crosswalkId: string, patch: { alias?: string | null; showAggregate?: boolean }) {
    const list = this.userSignals.get(userId) ?? [];
    const i = list.findIndex((s) => s.crosswalkId === crosswalkId);
    if (i < 0) return false;
    list[i] = {
      ...list[i],
      ...(patch.alias !== undefined && { alias: patch.alias }),
      ...(patch.showAggregate !== undefined && { showAggregate: patch.showAggregate, autoSwitched: false }),
    };
    return true;
  }
  async listGroupCrosswalks(groupId: string) {
    return [...this.crosswalks.values()].filter((c) => c.groupId === groupId);
  }
  async setAutoSwitch(userIds: string[], crosswalkIds: string[], on: boolean) {
    for (const u of userIds) {
      const list = this.userSignals.get(u) ?? [];
      for (const s of list) if (crosswalkIds.includes(s.crosswalkId)) Object.assign(s, { showAggregate: on, autoSwitched: on });
    }
  }
}
