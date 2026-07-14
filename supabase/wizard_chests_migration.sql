-- ============================================================================
-- Truhen (Loot-Chests) + Notizblock-Wirtschaft
--   * wizard_chests            – Truhen je Nutzer (Roll beim OEFFNEN)
--   * wizard_buy_tokens        – Verbrauchs-Notizblock-Pakete (Kristalle)
--   * slots_* / tokens_*       – neue Katalog-Zeilen (Slot-Upgrades / Pakete)
--   * Truhen-RPCs              – claim/list/open/buy + interner game-grant
--   * Trigger                  – Spielende (status=finished) vergibt Truhen
-- Kristalle sind serverseitig die Wahrheit; Truhen-Inhalt wird serverseitig
-- gewuerfelt (nicht faelschbar). Muster wie wizard_buy_item.
-- ============================================================================

-- --- Katalog: Mengen-Spalte + neue Artikel ---------------------------------
alter table public.wizard_catalog add column if not exists qty int not null default 0;

insert into public.wizard_catalog (item_id, kind, cost, currency, rarity, active, qty) values
  ('slots_2',   'slots',     1500, 'crystals', 'rare',      true, 0),
  ('slots_3',   'slots',     3500, 'crystals', 'epic',      true, 0),
  ('slots_5',   'slots',     7000, 'crystals', 'legendary', true, 0),
  ('tokens_1',  'tokenpack', 150,  'crystals', 'common',    true, 1),
  ('tokens_5',  'tokenpack', 600,  'crystals', 'rare',      true, 5),
  ('tokens_15', 'tokenpack', 1500, 'crystals', 'epic',      true, 15)
on conflict (item_id) do update set
  kind=excluded.kind, cost=excluded.cost, currency=excluded.currency,
  rarity=excluded.rarity, active=excluded.active, qty=excluded.qty;

-- --- Verbrauchs-Notizblock-Pakete kaufen (wiederholbar, KEIN Inventar) ------
create or replace function public.wizard_buy_tokens(p_pack_id text)
returns table(ok boolean, crystals int, gold int, granted int, message text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column   -- Rueckgabe-Spalte crystals/gold vs. Tabellenspalte
declare
  v_uid  uuid := auth.uid();
  v_item public.wizard_catalog%rowtype;
  v_w    public.wizard_wallets%rowtype;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.wizard_wallets(uid) values (v_uid) on conflict (uid) do nothing;

  select * into v_item from public.wizard_catalog
    where item_id = p_pack_id and active and kind = 'tokenpack';
  if not found then
    return query select false, w.crystals, w.gold, 0, 'Artikel nicht gefunden'
      from public.wizard_wallets w where w.uid = v_uid; return;
  end if;

  select * into v_w from public.wizard_wallets where uid = v_uid for update;
  if v_item.currency = 'crystals' and v_w.crystals < v_item.cost then
    return query select false, v_w.crystals, v_w.gold, 0, 'Nicht genug Kristalle'; return;
  elsif v_item.currency = 'gold' and v_w.gold < v_item.cost then
    return query select false, v_w.crystals, v_w.gold, 0, 'Nicht genug Gold'; return;
  end if;

  update public.wizard_wallets set
    crystals   = crystals - case when v_item.currency='crystals' then v_item.cost else 0 end,
    gold       = gold     - case when v_item.currency='gold'     then v_item.cost else 0 end,
    updated_at = now()
  where uid = v_uid;
  insert into public.wizard_ledger(uid, d_crystals, d_gold, reason, ref)
    values (v_uid,
      case when v_item.currency='crystals' then -v_item.cost else 0 end,
      case when v_item.currency='gold'     then -v_item.cost else 0 end,
      'buy_tokens', p_pack_id);

  return query select true, w.crystals, w.gold, v_item.qty, 'Gekauft'
    from public.wizard_wallets w where w.uid = v_uid;
end; $$;

-- ============================================================================
-- Truhen
-- ============================================================================
create table if not exists public.wizard_chests (
  id               uuid primary key default gen_random_uuid(),
  uid              uuid not null references auth.users(id) on delete cascade,
  rarity           text not null check (rarity in ('holz','silber','gold','diamant')),
  source           text not null check (source in ('daily','game','bought')),
  ref              text,                     -- game_id bei source='game'
  reward_crystals  int,                      -- NULL bis geoeffnet
  reward_item_id   text,
  reward_item_kind text,
  created_at       timestamptz not null default now(),
  opened_at        timestamptz               -- NULL = ungeoeffnet
);
alter table public.wizard_chests enable row level security;
drop policy if exists chest_read_own on public.wizard_chests;
create policy chest_read_own on public.wizard_chests for select using (uid = auth.uid());
-- KEINE Schreib-Policy -> nur Definer-Funktionen.

create index if not exists idx_wizard_chests_open
  on public.wizard_chests(uid) where opened_at is null;
-- 1 Gratis-Truhe je UTC-Tag:
create unique index if not exists uq_wizard_chest_daily
  on public.wizard_chests(uid, ((created_at at time zone 'UTC')::date))
  where source = 'daily';
-- 1 Spiel-Truhe je (Spieler, Spiel):
create unique index if not exists uq_wizard_chest_game
  on public.wizard_chests(uid, ref) where source = 'game';

-- --- Interne Wuerfel-Helfer (nicht fuer Clients freigegeben) ----------------
-- Seltenheit einer frischen Truhe aus gewichteter Verteilung (Summe=1).
create or replace function public._wiz_roll_rarity(p_odds jsonb)
returns text language plpgsql as $$
declare r double precision := random(); acc double precision := 0; k text; v double precision;
begin
  for k, v in select key, value::double precision from jsonb_each_text(p_odds) loop
    acc := acc + v; if r <= acc then return k; end if;
  end loop;
  return 'holz';
end; $$;

-- Inhalt einer Truhe: Kristalle (meist wenig, selten Jackpot) + Item-Chance.
create or replace function public._wiz_roll_reward(p_uid uuid, p_rarity text)
returns table(crystals int, item_id text, item_kind text)
language plpgsql as $$
declare r double precision := random(); c int; it record; item_pct double precision;
begin
  c := case p_rarity
    when 'holz'   then case when r<0.70 then 10+floor(random()*16)::int
                            when r<0.95 then 26+floor(random()*25)::int
                            when r<0.995 then 51+floor(random()*50)::int
                            else 150+floor(random()*150)::int end
    when 'silber' then case when r<0.65 then 25+floor(random()*36)::int
                            when r<0.93 then 61+floor(random()*60)::int
                            when r<0.99 then 121+floor(random()*130)::int
                            else 400+floor(random()*300)::int end
    when 'gold'   then case when r<0.60 then 60+floor(random()*81)::int
                            when r<0.90 then 141+floor(random()*160)::int
                            when r<0.985 then 301+floor(random()*300)::int
                            else 1000+floor(random()*800)::int end
    else               case when r<0.55 then 150+floor(random()*201)::int
                            when r<0.87 then 351+floor(random()*350)::int
                            when r<0.98 then 701+floor(random()*700)::int
                            else 2500+floor(random()*2500)::int end
  end;
  item_pct := case p_rarity when 'holz' then 0.05 when 'silber' then 0.15
                            when 'gold' then 0.35 else 0.70 end;

  crystals := c; item_id := null; item_kind := null;
  if random() < item_pct then
    select cat.item_id as iid, cat.kind as knd into it
    from public.wizard_catalog cat
    where cat.active
      and not exists (select 1 from public.wizard_inventory i
                      where i.uid = p_uid and i.item_id = cat.item_id)
      and cat.kind in ('avatar','deck','table','back','title')
    order by (random() * case cat.rarity
        when 'legendary' then case p_rarity when 'diamant' then 4.0 when 'gold' then 3.0 else 1.0 end
        when 'epic'      then case p_rarity when 'diamant' then 3.0 when 'gold' then 3.5 when 'silber' then 2.5 else 1.2 end
        when 'rare'      then case p_rarity when 'holz' then 3.0 when 'silber' then 3.0 else 1.5 end
        else                  case p_rarity when 'holz' then 3.0 else 1.0 end
      end) desc
    limit 1;
    if found then item_id := it.iid; item_kind := it.knd; end if;
  end if;
  return next;
end; $$;

-- --- Taegliche Gratis-Truhe holen (1x je UTC-Tag) ---------------------------
create or replace function public.wizard_claim_daily_chest()
returns table(ok boolean, chest_id uuid, rarity text, message text)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rar text; v_id uuid;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  v_rar := public._wiz_roll_rarity('{"holz":0.70,"silber":0.22,"gold":0.07,"diamant":0.01}');
  begin
    insert into public.wizard_chests(uid, rarity, source)
      values (v_uid, v_rar, 'daily') returning id into v_id;
  exception when unique_violation then
    return query select false, null::uuid, null::text, 'Heute schon geholt'; return;
  end;
  return query select true, v_id, v_rar, 'ok';
end; $$;

-- --- Ungeoeffnete Truhen auflisten ------------------------------------------
create or replace function public.wizard_list_chests()
returns table(id uuid, rarity text, source text, ref text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  return query select c.id, c.rarity, c.source, c.ref, c.created_at
    from public.wizard_chests c
    where c.uid = v_uid and c.opened_at is null
    order by c.created_at;
end; $$;

-- --- Truhe oeffnen (wuerfelt Inhalt, schreibt Wallet/Inventar gut) ----------
create or replace function public.wizard_open_chest(p_chest_id uuid)
returns table(ok boolean, crystals_won int, item_id text, item_kind text,
              new_crystals int, rarity text, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ch  public.wizard_chests%rowtype;
  v_c   int; v_it text; v_kd text; v_bal int;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  select * into v_ch from public.wizard_chests where id = p_chest_id and uid = v_uid for update;
  if not found then
    return query select false, 0, null::text, null::text,
      (select w.crystals from public.wizard_wallets w where w.uid=v_uid), null::text, 'Truhe nicht gefunden'; return;
  end if;
  if v_ch.opened_at is not null then
    return query select false, 0, null::text, null::text,
      (select w.crystals from public.wizard_wallets w where w.uid=v_uid), v_ch.rarity, 'Schon geöffnet'; return;
  end if;

  select rr.crystals, rr.item_id, rr.item_kind into v_c, v_it, v_kd
    from public._wiz_roll_reward(v_uid, v_ch.rarity) rr;

  insert into public.wizard_wallets(uid) values (v_uid) on conflict (uid) do nothing;
  update public.wizard_wallets set crystals = crystals + v_c, updated_at = now() where uid = v_uid;
  if v_it is not null then
    insert into public.wizard_inventory(uid, item_id, kind) values (v_uid, v_it, v_kd)
      on conflict (uid, item_id) do nothing;
  end if;
  update public.wizard_chests set
    reward_crystals = v_c, reward_item_id = v_it, reward_item_kind = v_kd, opened_at = now()
  where id = p_chest_id;
  insert into public.wizard_ledger(uid, d_crystals, d_gold, reason, ref)
    values (v_uid, v_c, 0, 'open_chest', p_chest_id::text);

  select w.crystals into v_bal from public.wizard_wallets w where w.uid = v_uid;
  return query select true, v_c, v_it, v_kd, v_bal, v_ch.rarity, 'ok';
end; $$;

-- --- Truhe mit Kristallen kaufen --------------------------------------------
create or replace function public.wizard_buy_chest(p_rarity text)
returns table(ok boolean, chest_id uuid, crystals int, message text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column   -- Rueckgabe-Spalte crystals vs. Tabellenspalte
declare v_uid uuid := auth.uid(); v_cost int; v_w public.wizard_wallets%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  v_cost := case p_rarity when 'holz' then 150 when 'silber' then 400
                          when 'gold' then 900 when 'diamant' then 2000 else null end;
  if v_cost is null then
    return query select false, null::uuid, 0, 'Unbekannte Truhe'; return;
  end if;
  insert into public.wizard_wallets(uid) values (v_uid) on conflict (uid) do nothing;
  select * into v_w from public.wizard_wallets where uid = v_uid for update;
  if v_w.crystals < v_cost then
    return query select false, null::uuid, v_w.crystals, 'Nicht genug Kristalle'; return;
  end if;
  update public.wizard_wallets set crystals = crystals - v_cost, updated_at = now() where uid = v_uid;
  insert into public.wizard_chests(uid, rarity, source) values (v_uid, p_rarity, 'bought')
    returning id into v_id;
  insert into public.wizard_ledger(uid, d_crystals, d_gold, reason, ref)
    values (v_uid, -v_cost, 0, 'buy_chest', p_rarity);
  return query select true, v_id, (select w.crystals from public.wizard_wallets w where w.uid=v_uid), 'Gekauft';
end; $$;

-- --- Spielende: je Teilnehmer eine Truhe (Sieger = bessere Odds), idempotent -
create or replace function public.wizard_grant_game_chest(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_winner uuid; r record; v_rar text;
begin
  select uid into v_winner from public.wizard_players
    where game_id = p_game order by total_score desc, seat limit 1;
  for r in select uid from public.wizard_players where game_id = p_game loop
    v_rar := public._wiz_roll_rarity(case when r.uid = v_winner
      then '{"holz":0.30,"silber":0.40,"gold":0.25,"diamant":0.05}'::jsonb
      else '{"holz":0.65,"silber":0.27,"gold":0.07,"diamant":0.01}'::jsonb end);
    insert into public.wizard_chests(uid, rarity, source, ref)
      values (r.uid, v_rar, 'game', p_game::text)
      on conflict (uid, ref) where source = 'game' do nothing;   -- idempotent
  end loop;
end; $$;

-- Trigger: sobald ein Spiel auf status='finished' wechselt -> Truhen vergeben.
create or replace function public.wizard_on_game_finish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' then
    perform public.wizard_grant_game_chest(new.id);
  end if;
  return new;
end; $$;
drop trigger if exists trg_wizard_game_finish on public.wizard_games;
create trigger trg_wizard_game_finish after update on public.wizard_games
  for each row execute function public.wizard_on_game_finish();

-- --- Rechte: nur angemeldete Nutzer duerfen die oeffentlichen RPCs rufen ----
do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_buy_tokens(text)', 'wizard_claim_daily_chest()', 'wizard_list_chests()',
    'wizard_open_chest(uuid)', 'wizard_buy_chest(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- ============================================================================
-- v2 (Migration wizard_chest_multidrop): MEHRERE Drops pro Truhe.
--   * Drops: holz 2, silber 3, gold 4, diamant 5 (max. 2 Items je Truhe)
--   * Jeder Drop: 60% Kristalle / 40% Gold, Item-Chance je Drop
--     (holz 2.5% / silber 5% / gold 9% / diamant 15%)
--   * wizard_chests.reward_json speichert das Drop-Array
--   * wizard_open_chest gibt jetzt (ok, rewards jsonb, new_crystals, new_gold,
--     rarity, message) zurueck -> Client deckt Drop fuer Drop auf
-- Vollstaendiger Funktionstext: siehe Migration wizard_chest_multidrop in
-- Supabase (Stand der Wahrheit ist die Live-DB; hier nur die Signaturen).
-- ============================================================================
-- alter table public.wizard_chests add column reward_json jsonb;
-- function public._wiz_roll_drop(p_uid uuid, p_rarity text, p_no_item boolean, p_skip text[]) returns jsonb
-- function public.wizard_open_chest(p_chest_id uuid)
--   returns table(ok boolean, rewards jsonb, new_crystals int, new_gold int, rarity text, message text)

-- ============================================================================
-- v3 (Migration wizard_chest_spin_upgrade): Truhen-Drehen mit Upgrade-Chance.
--   * wizard_chests.spins (max. 3 Drehungen je Truhe)
--   * wizard_spin_chest(uuid) -> (ok, rarity, upgraded, spins)
--   * Chancen je Dreh: holz->silber 6%, silber->gold 4%, gold->diamant 2,5%
-- ============================================================================
