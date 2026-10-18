// 좌표 계산. 좌표는 [lng, lat]
export type LngLat = [number, number];

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** 북쪽 기준 시계 방향 각도 (0~360) */
export function bearing(from: LngLat, to: LngLat): number {
  const y = Math.sin(rad(to[0] - from[0])) * Math.cos(rad(to[1]));
  const x = Math.cos(rad(from[1])) * Math.sin(rad(to[1])) - Math.sin(rad(from[1])) * Math.cos(rad(to[1])) * Math.cos(rad(to[0] - from[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 방향 없는 두 선분의 각도 차이 (0~90). 중복 제안 기준 20° (D-028) */
export function lineBearingDiff(a: [LngLat, LngLat], b: [LngLat, LngLat]): number {
  const d = Math.abs((bearing(a[0], a[1]) % 180) - (bearing(b[0], b[1]) % 180));
  return Math.min(d, 180 - d);
}

const DIR4 = ["북쪽", "동쪽", "남쪽", "서쪽"];
const DIR8 = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

/** 교차로 중심 → 횡단보도 중점의 4방위 (D-058) */
export const directionLabel = (center: LngLat, point: LngLat) => DIR4[Math.round(bearing(center, point) / 90) % 4];

export const direction8 = (center: LngLat, point: LngLat) => DIR8[Math.round(bearing(center, point) / 45) % 8];
