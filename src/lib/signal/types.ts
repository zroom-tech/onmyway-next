// traffic-signal 도메인 타입. 용어는 기획 레포 knowledge/glossary.md를 따른다.

/** 한 사용자의 기록 1건을 계산 가능한 형태로 정리한 것 (부록 A-2 산출값) */
export type SignalRecord = {
  user: string;
  /** 주기, 정수 초 (D-018) */
  C: number;
  /** 녹색 시간, 정수 초 (D-018) */
  G: number;
  /** 반올림 전 녹색 시간 — 집계 중앙값 계산용 */
  Graw: number;
  /** 위상 = 기준 시점 mod C */
  phase: number;
  /** 기록 시각 (epoch 초) — "최근" 판단용 */
  at: number;
};

export type Aggregate = {
  C: number;
  G: number;
  phase: number;
  /** 집계 창 (집계와 일치하는 최근 기록, 사용자당 1건) */
  window: SignalRecord[];
};

export type InfoLevel = "fresh" | "stale" | "expired" | "nodata";
export type Verification = "unverified" | "confirmed";

/** 신호 그룹 × 시간대 구간 하나의 상태 */
export type GroupSlotState = {
  agg: Aggregate | null;
  /** 불일치 기록 보관 */
  mismatched: SignalRecord[];
  /** 마지막 일치 기록 이후 신고·불일치 기록을 남긴 사용자 (의심 수) */
  suspects: string[];
  /** 마지막 일치 기록 이후 "시간이 안 맞아요" 신고 사용자 */
  reporters: string[];
  /** 마지막 일치 기록 시각 (최신성 표시) */
  lastMatchAt: number | null;
  /** 직전 처리에서 신호 변경으로 집계가 교체됐는지 — 자동 전환 저장 트리거 (FR-02-F-04, service.submitRecord) */
  replaced: boolean;
  /** 직전 처리가 그룹 합류 첫 기록 불일치로 거절됐는지 (FR-03-C-05) */
  rejectedJoin: boolean;
};

export type Tap = { kind: "green" | "red"; at: number };
