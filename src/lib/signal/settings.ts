// 운영 설정값 초기값 (PRD §운영 설정값). 운영자가 바꿀 수 있는 값이라 상수로 흩어 두지 않는다.
export const SIGNAL_SETTINGS = {
  cycleMin: 20,
  cycleMax: 300,
  greenMin: 5,
  tapTimeout: 300,
  matchGreenTolerance: 1,
  matchPhaseTolerance: 2,
  windowSize: 10,
  /** 검증 전: 신고 수 기준 [오래됨, 만료] */
  unverifiedThresholds: [1, 2] as const,
  /** 확인됨: 의심 수 기준 [오래됨, 만료] */
  confirmedThresholds: [2, 3] as const,
};

export type SignalSettings = typeof SIGNAL_SETTINGS;
