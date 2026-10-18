-- 위치 없는 "나만 보기" 신호등 (traffic-signal D-074).
-- 위치·교차로·공유 이름이 비어 있고 is_private = true. 이름은 등록자의 user_signals.alias에 둔다.
-- 위치를 지정하면 공유 횡단보도를 새로 만들고 기록을 옮긴 뒤 이 행은 지운다 (src/lib/signal/register.ts setCrosswalkLocation).

alter table crosswalks
  alter column intersection_id drop not null,
  alter column end_a drop not null,
  alter column end_b drop not null,
  alter column midpoint drop not null,
  alter column shared_name drop not null,
  add column is_private boolean not null default false;

alter table crosswalks add constraint crosswalks_location_chk check (
  (is_private and end_a is null and end_b is null and midpoint is null and intersection_id is null and shared_name is null)
  or (not is_private and end_a is not null and end_b is not null and midpoint is not null and intersection_id is not null and shared_name is not null)
);

alter table signal_groups alter column intersection_id drop not null;

-- 뒤에 열을 붙이는 것만 허용되므로 기존 열 순서는 그대로 둔다
create or replace view crosswalks_v as
select c.id, c.group_id, c.intersection_id, c.shared_name, c.hidden,
       st_x(c.end_a::geometry) as a_lng, st_y(c.end_a::geometry) as a_lat,
       st_x(c.end_b::geometry) as b_lng, st_y(c.end_b::geometry) as b_lat,
       g.button_marks, c.is_private, c.created_by
from crosswalks c join signal_groups g on g.id = c.group_id;

-- 나만 보기는 지도·주변 조회에 나오지 않는다 (위치가 없어 원래도 걸리지 않지만 명시)
create or replace function crosswalks_in_bbox(min_lng float8, min_lat float8, max_lng float8, max_lat float8)
returns setof crosswalks_v language sql stable as $$
  select v.* from crosswalks_v v join crosswalks c on c.id = v.id
  where not c.hidden and not c.is_private
    and c.midpoint && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
$$;

create or replace function crosswalks_near(lng float8, lat float8, radius_m float8)
returns setof crosswalks_v language sql stable as $$
  select v.* from crosswalks_v v join crosswalks c on c.id = v.id
  where not c.hidden and not c.is_private
    and st_dwithin(c.midpoint, st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_m)
  order by st_distance(c.midpoint, st_setsrid(st_makepoint(lng, lat), 4326)::geography)
$$;
