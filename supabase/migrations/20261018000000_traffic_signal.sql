-- traffic-signal MVP 스키마 (기획: onmyway-planning/projects/traffic-signal/drafts/03-prd.md)
-- 앱·웹은 이 테이블을 직접 읽지 않는다. 모든 접근은 Next.js Route Handler(서비스 롤)가 한다 (D-065).
-- 위치 원본 저장 범위(OD-004)·탈퇴 시 처리(OD-009)는 법무 회신(LR-01) 대기 — 사용자 현재 위치는 저장하지 않는다.

create extension if not exists postgis;

-- 교차로: 중점 40m 이내 횡단보도 묶음 (D-028)
create table intersections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- 신호 그룹: 같은 순간 녹색이 켜지는 횡단보도 묶음 (D-010, D-029)
create table signal_groups (
  id uuid primary key default gen_random_uuid(),
  intersection_id uuid not null references intersections(id),
  is_scramble boolean not null default false,
  -- 버튼식 표시 사용자 (D-025, 2명 이상이면 확정)
  button_marks uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 횡단보도: 양 끝점 2개 (D-027), 공유 이름 자동 생성 (D-058)
create table crosswalks (
  id uuid primary key default gen_random_uuid(),
  intersection_id uuid not null references intersections(id),
  group_id uuid not null references signal_groups(id),
  end_a geography(point, 4326) not null,
  end_b geography(point, 4326) not null,
  midpoint geography(point, 4326) not null,
  shared_name text not null,
  created_by uuid not null references auth.users(id),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index crosswalks_midpoint_gix on crosswalks using gist (midpoint);

-- 기록: 탭 3회 원본 + 산출값 (부록 A-2). 사용자 위치는 저장하지 않는다 (50m 확인은 기록 시점 검사만)
create table records (
  id uuid primary key default gen_random_uuid(),
  crosswalk_id uuid not null references crosswalks(id),
  group_id uuid not null references signal_groups(id),
  user_id uuid not null references auth.users(id),
  day_type text not null check (day_type in ('weekday', 'weekend')),
  hour smallint not null check (hour between 0 and 23),
  taps jsonb not null,
  cycle smallint not null,
  green smallint not null,
  green_raw real not null,
  phase real not null,
  hidden boolean not null default false,
  recorded_at timestamptz not null default now()
);
create index records_group_slot_idx on records (group_id, day_type, hour, recorded_at desc);

-- 그룹 × 시간대 구간 상태 (부록 A-4 엔진 상태, src/lib/signal/types.ts GroupSlotState)
create table group_slot_states (
  group_id uuid not null references signal_groups(id),
  day_type text not null check (day_type in ('weekday', 'weekend')),
  hour smallint not null check (hour between 0 and 23),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, day_type, hour)
);

-- 신고 (D-033): 하루 1회 = KST 날짜 (D-043)
create table reports (
  id uuid primary key default gen_random_uuid(),
  crosswalk_id uuid not null references crosswalks(id),
  group_id uuid not null references signal_groups(id),
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('time_mismatch', 'not_together', 'location_wrong')),
  report_date date not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected', 'auto')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id, report_date)
);

-- 내 신호등 (D-050) + 별칭 (D-058) + 대표값 보기 스위치 (D-053)
create table user_signals (
  user_id uuid not null references auth.users(id) on delete cascade,
  crosswalk_id uuid not null references crosswalks(id),
  alias text check (char_length(alias) <= 20),
  show_aggregate boolean not null default false,
  -- 신호 변경으로 대표값에 자동 전환됨 (FR-02-F-04). 스위치를 바꾸거나 다시 기록하면 false
  auto_switched boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (user_id, crosswalk_id)
);

-- 사용자 제재 (D-041)
create table sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  scopes text[] not null,
  reason text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid not null
);

-- 공휴일 (D-031: 공휴일은 주말 취급) — 운영자 관리
create table holidays (
  day date primary key,
  name text not null
);

-- 운영 설정값 (PRD §운영 설정값)
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- 감사 로그 (A-12)
create table audit_logs (
  id bigserial primary key,
  actor uuid not null,
  action text not null,
  target text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- 직접 접근 차단: 모든 접근은 서비스 롤(Next.js)만
alter table intersections enable row level security;
alter table signal_groups enable row level security;
alter table crosswalks enable row level security;
alter table records enable row level security;
alter table group_slot_states enable row level security;
alter table reports enable row level security;
alter table user_signals enable row level security;
alter table sanctions enable row level security;
alter table holidays enable row level security;
alter table settings enable row level security;
alter table audit_logs enable row level security;

-- 조회용 뷰: 좌표를 경도·위도 숫자로 (Next.js 저장소 구현에서 사용)
create view crosswalks_v as
select c.id, c.group_id, c.intersection_id, c.shared_name, c.hidden,
       st_x(c.end_a::geometry) as a_lng, st_y(c.end_a::geometry) as a_lat,
       st_x(c.end_b::geometry) as b_lng, st_y(c.end_b::geometry) as b_lat,
       g.button_marks
from crosswalks c join signal_groups g on g.id = c.group_id;

-- 동네 탭 화면 범위 조회 (FR-01-B-01)
create function crosswalks_in_bbox(min_lng float8, min_lat float8, max_lng float8, max_lat float8)
returns setof crosswalks_v language sql stable as $$
  select v.* from crosswalks_v v join crosswalks c on c.id = v.id
  where not c.hidden
    and c.midpoint && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
$$;

-- 등록: 반경 안 횡단보도 (중복 제안 15m, 교차로 묶음 40m — D-028)
create function crosswalks_near(lng float8, lat float8, radius_m float8)
returns setof crosswalks_v language sql stable as $$
  select v.* from crosswalks_v v join crosswalks c on c.id = v.id
  where not c.hidden
    and st_dwithin(c.midpoint, st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_m)
  order by st_distance(c.midpoint, st_setsrid(st_makepoint(lng, lat), 4326)::geography)
$$;

-- 등록: 끝점 좌표로 횡단보도 생성 (geography 변환은 DB에서)
create function create_crosswalk(
  p_intersection uuid, p_group uuid, p_name text, p_created_by uuid,
  a_lng float8, a_lat float8, b_lng float8, b_lat float8
) returns uuid language sql as $$
  insert into crosswalks (intersection_id, group_id, shared_name, created_by, end_a, end_b, midpoint)
  values (
    p_intersection, p_group, p_name, p_created_by,
    st_setsrid(st_makepoint(a_lng, a_lat), 4326)::geography,
    st_setsrid(st_makepoint(b_lng, b_lat), 4326)::geography,
    st_setsrid(st_makepoint((a_lng + b_lng) / 2, (a_lat + b_lat) / 2), 4326)::geography
  )
  returning id
$$;

-- 버튼식 표시 (D-025): 중복 없이 추가
create function add_button_mark(p_group uuid, p_user uuid)
returns void language sql as $$
  update signal_groups set button_marks = array_append(button_marks, p_user)
  where id = p_group and not (p_user = any(button_marks))
$$;
