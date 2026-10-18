// 장소·주소 역검색 (D-058 공유 이름, D-064 Nominatim).
// 공개 Nominatim은 개발용이다 — 사용 정책상 초당 1회, 식별 가능한 User-Agent 필요. 출시 전 자체 서버로 바꾼다.
export type ReverseResult = { place: string | null; road: string | null };

export interface Geocoder {
  reverse(lng: number, lat: number): Promise<ReverseResult>;
}

type NominatimResponse = {
  name?: string;
  address?: { road?: string; pedestrian?: string; amenity?: string; shop?: string; building?: string };
};

export class NominatimGeocoder implements Geocoder {
  constructor(
    private baseUrl = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
    private userAgent = process.env.NOMINATIM_USER_AGENT ?? "onmyway-dev",
  ) {}

  async reverse(lng: number, lat: number): Promise<ReverseResult> {
    const url = `${this.baseUrl}/reverse?format=jsonv2&zoom=18&accept-language=ko&lat=${lat}&lon=${lng}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": this.userAgent } });
      if (!res.ok) return { place: null, road: null };
      const j = (await res.json()) as NominatimResponse;
      const a = j.address ?? {};
      return { place: j.name || a.amenity || a.shop || a.building || null, road: a.road || a.pedestrian || null };
    } catch {
      return { place: null, road: null };
    }
  }
}
