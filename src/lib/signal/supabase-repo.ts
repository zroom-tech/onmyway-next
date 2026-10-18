// Supabase(Postgres + PostGIS) 저장소 구현 (D-065). 서비스 롤 키는 서버에서만 쓴다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Slot } from "./slot";
import type { Crosswalk, NewCrosswalk, PrivateCrosswalk, ReportKind, SanctionScope, SharedCrosswalk, SignalRepo, StoredRecord, UserSignal } from "./repo";
import type { GroupSlotState } from "./types";

type CrosswalkRow = {
  id: string;
  group_id: string;
  intersection_id: string | null;
  shared_name: string | null;
  a_lng: number | null;
  a_lat: number | null;
  b_lng: number | null;
  b_lat: number | null;
  button_marks: string[];
  is_private: boolean;
  created_by: string;
};

const toCrosswalk = (r: CrosswalkRow): Crosswalk => {
  const base = { id: r.id, groupId: r.group_id, buttonMarks: r.button_marks, createdBy: r.created_by };
  // DB 제약(crosswalks_location_chk)이 공유 = 위치·교차로·이름 모두 있음을 보장한다
  if (r.is_private) return { ...base, isPrivate: true, intersectionId: null, sharedName: null, endA: null, endB: null };
  return { ...base, isPrivate: false, intersectionId: r.intersection_id!, sharedName: r.shared_name!, endA: [r.a_lng!, r.a_lat!], endB: [r.b_lng!, r.b_lat!] };
};
const toShared = (r: CrosswalkRow) => toCrosswalk(r) as SharedCrosswalk;

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function serviceClient(): SupabaseClient {
  // Vercel Supabase 연동은 URL을 NEXT_PUBLIC_SUPABASE_URL로만 넣는다. URL은 비밀이 아니고 키는 서버 전용 그대로다
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요해요");
  return createClient(url, key, { auth: { persistSession: false } });
}

export class SupabaseRepo implements SignalRepo {
  constructor(private db: SupabaseClient = serviceClient()) {}

  async getCrosswalk(id: string) {
    const row = must(await this.db.from("crosswalks_v").select("*").eq("id", id).eq("hidden", false).maybeSingle());
    return row ? toCrosswalk(row as CrosswalkRow) : null;
  }

  async listCrosswalks(q: { ids?: string[]; bbox?: [number, number, number, number] }) {
    if (q.bbox) {
      const [min_lng, min_lat, max_lng, max_lat] = q.bbox;
      const rows = must(await this.db.rpc("crosswalks_in_bbox", { min_lng, min_lat, max_lng, max_lat }));
      return (rows as CrosswalkRow[]).map(toShared);
    }
    if (!q.ids?.length) return [];
    const rows = must(await this.db.from("crosswalks_v").select("*").in("id", q.ids).eq("hidden", false));
    return (rows as CrosswalkRow[]).map(toCrosswalk);
  }

  async getState(groupId: string, slot: Slot) {
    const row = must(
      await this.db
        .from("group_slot_states")
        .select("state")
        .match({ group_id: groupId, day_type: slot.dayType, hour: slot.hour })
        .maybeSingle(),
    );
    return row ? ((row as { state: GroupSlotState }).state) : null;
  }

  async saveState(groupId: string, slot: Slot, state: GroupSlotState) {
    must(
      await this.db.from("group_slot_states").upsert({
        group_id: groupId,
        day_type: slot.dayType,
        hour: slot.hour,
        state,
        updated_at: new Date().toISOString(),
      }),
    );
  }

  async insertRecord(r: StoredRecord) {
    must(
      await this.db.from("records").insert({
        crosswalk_id: r.crosswalkId,
        group_id: r.groupId,
        user_id: r.user,
        day_type: r.slot.dayType,
        hour: r.slot.hour,
        taps: r.taps,
        cycle: r.C,
        green: r.G,
        green_raw: r.Graw,
        phase: r.phase,
        recorded_at: new Date(r.at * 1000).toISOString(),
      }),
    );
  }

  async latestRecordOf(userId: string, groupId: string, slot: Slot) {
    const row = must(
      await this.db
        .from("records")
        .select("*")
        .match({ user_id: userId, group_id: groupId, day_type: slot.dayType, hour: slot.hour, hidden: false })
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as null | Record<string, unknown>;
    if (!row) return null;
    return {
      user: row.user_id as string,
      C: row.cycle as number,
      G: row.green as number,
      Graw: row.green_raw as number,
      phase: row.phase as number,
      at: Date.parse(row.recorded_at as string) / 1000,
      crosswalkId: row.crosswalk_id as string,
      groupId: row.group_id as string,
      slot,
      taps: row.taps as StoredRecord["taps"],
    };
  }

  async countRecordsBySlot(groupId: string, slot: Slot) {
    const res = await this.db
      .from("records")
      .select("id", { count: "exact", head: true })
      .match({ group_id: groupId, day_type: slot.dayType, hour: slot.hour, hidden: false });
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async listUserSignals(userId: string): Promise<UserSignal[]> {
    const rows = must(await this.db.from("user_signals").select("crosswalk_id, alias, show_aggregate, auto_switched").eq("user_id", userId));
    return (rows as { crosswalk_id: string; alias: string | null; show_aggregate: boolean; auto_switched: boolean }[]).map((r) => ({
      crosswalkId: r.crosswalk_id,
      alias: r.alias,
      showAggregate: r.show_aggregate,
      autoSwitched: r.auto_switched,
    }));
  }

  async upsertUserSignal(userId: string, crosswalkId: string) {
    must(
      await this.db
        .from("user_signals")
        .upsert({ user_id: userId, crosswalk_id: crosswalkId }, { onConflict: "user_id,crosswalk_id", ignoreDuplicates: true }),
    );
  }

  async isSanctioned(userId: string, scope: SanctionScope, at: number) {
    const iso = new Date(at * 1000).toISOString();
    const rows = must(
      await this.db
        .from("sanctions")
        .select("id")
        .eq("user_id", userId)
        .contains("scopes", [scope])
        .lte("starts_at", iso)
        .gt("ends_at", iso)
        .limit(1),
    );
    return (rows as unknown[]).length > 0;
  }

  async holidays() {
    const rows = must(await this.db.from("holidays").select("day"));
    return new Set((rows as { day: string }[]).map((r) => r.day));
  }

  async findCrosswalksNear(point: [number, number], radiusM: number) {
    const rows = must(await this.db.rpc("crosswalks_near", { lng: point[0], lat: point[1], radius_m: radiusM }));
    return (rows as CrosswalkRow[]).map(toShared);
  }

  async listIntersectionCrosswalks(intersectionId: string) {
    const rows = must(await this.db.from("crosswalks_v").select("*").eq("intersection_id", intersectionId).eq("hidden", false));
    return (rows as CrosswalkRow[]).map(toShared);
  }

  async createIntersection() {
    const row = must(await this.db.from("intersections").insert({}).select("id").single());
    return (row as unknown as { id: string }).id;
  }

  async createGroup(intersectionId: string | null, isScramble: boolean) {
    const row = must(await this.db.from("signal_groups").insert({ intersection_id: intersectionId, is_scramble: isScramble }).select("id").single());
    return (row as unknown as { id: string }).id;
  }

  async createCrosswalk(c: NewCrosswalk) {
    const id = must(
      await this.db.rpc("create_crosswalk", {
        p_intersection: c.intersectionId,
        p_group: c.groupId,
        p_name: c.sharedName,
        p_created_by: c.createdBy,
        a_lng: c.endA[0],
        a_lat: c.endA[1],
        b_lng: c.endB[0],
        b_lat: c.endB[1],
      }),
    ) as string;
    return (await this.getCrosswalk(id)) as SharedCrosswalk;
  }

  async createPrivateCrosswalk(groupId: string, createdBy: string) {
    const row = must(await this.db.from("crosswalks").insert({ group_id: groupId, created_by: createdBy, is_private: true }).select("id").single());
    return (await this.getCrosswalk((row as unknown as { id: string }).id)) as PrivateCrosswalk;
  }

  async listCrosswalkRecords(crosswalkId: string): Promise<StoredRecord[]> {
    const rows = must(await this.db.from("records").select("*").eq("crosswalk_id", crosswalkId).eq("hidden", false).order("recorded_at", { ascending: true }));
    return (rows as Record<string, unknown>[]).map((row) => ({
      user: row.user_id as string,
      C: row.cycle as number,
      G: row.green as number,
      Graw: row.green_raw as number,
      phase: row.phase as number,
      at: Date.parse(row.recorded_at as string) / 1000,
      crosswalkId,
      groupId: row.group_id as string,
      slot: { dayType: row.day_type as "weekday" | "weekend", hour: row.hour as number },
      taps: row.taps as StoredRecord["taps"],
    }));
  }

  async deletePrivateCrosswalk(crosswalkId: string) {
    const cw = await this.getCrosswalk(crosswalkId);
    if (!cw?.isPrivate) return;
    // 나만 보기 그룹은 이 횡단보도 하나뿐이다 (D-074)
    must(await this.db.from("records").delete().eq("crosswalk_id", crosswalkId));
    must(await this.db.from("reports").delete().eq("crosswalk_id", crosswalkId));
    must(await this.db.from("user_signals").delete().eq("crosswalk_id", crosswalkId));
    must(await this.db.from("group_slot_states").delete().eq("group_id", cw.groupId));
    must(await this.db.from("crosswalks").delete().eq("id", crosswalkId));
    must(await this.db.from("signal_groups").delete().eq("id", cw.groupId));
  }

  async setCrosswalkGroup(crosswalkIds: string[], groupId: string) {
    if (!crosswalkIds.length) return;
    must(await this.db.from("crosswalks").update({ group_id: groupId }).in("id", crosswalkIds));
  }

  async countRegistrationsOn(userId: string, kstDate: string) {
    // KST 하루 = 전날 15:00Z ~ 당일 15:00Z
    const start = new Date(Date.parse(`${kstDate}T00:00:00+09:00`)).toISOString();
    const end = new Date(Date.parse(`${kstDate}T00:00:00+09:00`) + 86400000).toISOString();
    const res = await this.db
      .from("crosswalks")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId)
      .gte("created_at", start)
      .lt("created_at", end);
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async addButtonMark(groupId: string, userId: string) {
    must(await this.db.rpc("add_button_mark", { p_group: groupId, p_user: userId }));
  }

  async insertReport(r: { crosswalkId: string; groupId: string; userId: string; kind: ReportKind; reportDate: string; status: "open" | "auto" }) {
    const res = await this.db.from("reports").insert({
      crosswalk_id: r.crosswalkId,
      group_id: r.groupId,
      user_id: r.userId,
      kind: r.kind,
      report_date: r.reportDate,
      status: r.status,
    });
    if (res.error?.code === "23505") return false; // unique (group_id, user_id, report_date)
    if (res.error) throw new Error(res.error.message);
    return true;
  }

  async removeUserSignal(userId: string, crosswalkId: string) {
    must(await this.db.from("user_signals").delete().match({ user_id: userId, crosswalk_id: crosswalkId }));
  }

  async updateUserSignal(userId: string, crosswalkId: string, patch: { alias?: string | null; showAggregate?: boolean }) {
    const values: Record<string, unknown> = {};
    if (patch.alias !== undefined) values.alias = patch.alias;
    if (patch.showAggregate !== undefined) Object.assign(values, { show_aggregate: patch.showAggregate, auto_switched: false });
    const rows = must(await this.db.from("user_signals").update(values).match({ user_id: userId, crosswalk_id: crosswalkId }).select("crosswalk_id"));
    return (rows as unknown[]).length > 0;
  }

  async listGroupCrosswalks(groupId: string) {
    const rows = must(await this.db.from("crosswalks_v").select("*").eq("group_id", groupId).eq("hidden", false));
    return (rows as CrosswalkRow[]).map(toCrosswalk);
  }

  async setAutoSwitch(userIds: string[], crosswalkIds: string[], on: boolean) {
    if (!userIds.length || !crosswalkIds.length) return;
    must(
      await this.db
        .from("user_signals")
        .update({ show_aggregate: on, auto_switched: on })
        .in("user_id", userIds)
        .in("crosswalk_id", crosswalkIds),
    );
  }
}
