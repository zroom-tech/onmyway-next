// 저장소 경계. 실제 구현은 supabase-repo.ts, 테스트는 memory-repo.ts
import type { Slot } from "./slot";
import type { GroupSlotState, SignalRecord, Tap } from "./types";

type CrosswalkBase = {
  id: string;
  groupId: string;
  buttonMarks: string[];
  createdBy: string;
};

/** 위치 있는 공유 횡단보도 */
export type SharedCrosswalk = CrosswalkBase & {
  isPrivate: false;
  intersectionId: string;
  sharedName: string;
  endA: [number, number]; // [lng, lat]
  endB: [number, number];
};

/** 위치 없는 나만 보기 신호등 (D-074). 이름은 등록자의 UserSignal.alias */
export type PrivateCrosswalk = CrosswalkBase & {
  isPrivate: true;
  intersectionId: null;
  sharedName: null;
  endA: null;
  endB: null;
};

export type Crosswalk = SharedCrosswalk | PrivateCrosswalk;

/** 나만 보기는 등록자에게만 보인다 (D-074) */
export const visibleTo = (c: Crosswalk, userId: string | undefined) => !c.isPrivate || c.createdBy === userId;

export type StoredRecord = SignalRecord & {
  crosswalkId: string;
  groupId: string;
  slot: Slot;
  taps: Tap[];
};

/** autoSwitched: 신호 변경으로 대표값에 자동 전환됨 (FR-02-F-04). 스위치를 직접 바꾸거나 다시 기록하면 해제 */
export type UserSignal = { crosswalkId: string; alias: string | null; showAggregate: boolean; autoSwitched: boolean };

export type SanctionScope = "register" | "record" | "report";

export type ReportKind = "time_mismatch" | "not_together" | "location_wrong";

export type NewCrosswalk = Omit<SharedCrosswalk, "id" | "buttonMarks" | "isPrivate">;

export interface SignalRepo {
  getCrosswalk(id: string): Promise<Crosswalk | null>;
  /** bbox 조회는 공유 횡단보도만 */
  listCrosswalks(q: { ids?: string[]; bbox?: [number, number, number, number] }): Promise<Crosswalk[]>;
  getState(groupId: string, slot: Slot): Promise<GroupSlotState | null>;
  saveState(groupId: string, slot: Slot, state: GroupSlotState): Promise<void>;
  insertRecord(r: StoredRecord): Promise<void>;
  latestRecordOf(userId: string, groupId: string, slot: Slot): Promise<StoredRecord | null>;
  countRecordsBySlot(groupId: string, slot: Slot): Promise<number>;
  listUserSignals(userId: string): Promise<UserSignal[]>;
  upsertUserSignal(userId: string, crosswalkId: string): Promise<void>;
  isSanctioned(userId: string, scope: SanctionScope, at: number): Promise<boolean>;
  holidays(): Promise<Set<string>>;

  // M2 — 등록·신고·내 신호등
  findCrosswalksNear(point: [number, number], radiusM: number): Promise<SharedCrosswalk[]>;
  listIntersectionCrosswalks(intersectionId: string): Promise<SharedCrosswalk[]>;
  createIntersection(): Promise<string>;
  /** 나만 보기 그룹은 교차로 없음 */
  createGroup(intersectionId: string | null, isScramble: boolean): Promise<string>;
  createCrosswalk(c: NewCrosswalk): Promise<SharedCrosswalk>;
  createPrivateCrosswalk(groupId: string, createdBy: string): Promise<PrivateCrosswalk>;
  /** 이 횡단보도에서 잰 기록 전체, 오래된 순 (위치 지정 때 옮긴다) */
  listCrosswalkRecords(crosswalkId: string): Promise<StoredRecord[]>;
  /** 나만 보기 신호등을 기록·신고·내 신호등·그룹·구간 상태까지 지운다 */
  deletePrivateCrosswalk(crosswalkId: string): Promise<void>;
  setCrosswalkGroup(crosswalkIds: string[], groupId: string): Promise<void>;
  countRegistrationsOn(userId: string, kstDate: string): Promise<number>;
  addButtonMark(groupId: string, userId: string): Promise<void>;
  /** 같은 그룹 × 사용자 × 날짜가 이미 있으면 false (D-033 하루 1회) */
  insertReport(r: { crosswalkId: string; groupId: string; userId: string; kind: ReportKind; reportDate: string; status: "open" | "auto" }): Promise<boolean>;
  removeUserSignal(userId: string, crosswalkId: string): Promise<void>;
  updateUserSignal(userId: string, crosswalkId: string, patch: { alias?: string | null; showAggregate?: boolean }): Promise<boolean>;
  listGroupCrosswalks(groupId: string): Promise<Crosswalk[]>;
  /** 사용자들의 해당 횡단보도 표시 기준을 자동 전환(on) 또는 내 기록으로 복귀(off) */
  setAutoSwitch(userIds: string[], crosswalkIds: string[], on: boolean): Promise<void>;
}
