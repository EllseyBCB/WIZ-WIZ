-- ============================================================================
-- Wirtschaftssystem (Fundament): Kristalle (Echtgeld-Waehrung) + Gold
-- (Spielwaehrung), serverseitig gefuehrt => NICHT vom Client manipulierbar.
--   * wizard_wallets   – Guthaben je Nutzer
--   * wizard_catalog   – Preis-Wahrheit (Client kann Preise nicht faelschen)
--   * wizard_inventory – gekaufte/freigeschaltete Kosmetik
--   * wizard_ledger    – Buchungslog (Audit)
-- Alle Aenderungen laufen ausschliesslich ueber SECURITY-DEFINER-Funktionen;
-- direktes Schreiben ist per RLS gesperrt.
-- ============================================================================

-- --- Geldboerse -------------------------------------------------------------
create table if not exists public.wizard_wallets (
  uid        uuid primary key references auth.users(id) on delete cascade,
  crystals   int not null default 0 check (crystals >= 0),
  gold       int not null default 0 check (gold >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wizard_wallets enable row level security;
drop policy if exists wallet_read_own on public.wizard_wallets;
create policy wallet_read_own on public.wizard_wallets
  for select using (uid = auth.uid());
-- KEINE Insert/Update/Delete-Policy -> nur Definer-Funktionen aendern Guthaben.

-- --- Katalog (oeffentlich lesbar; Preise sind hier die Wahrheit) ------------
create table if not exists public.wizard_catalog (
  item_id  text primary key,
  kind     text not null,            -- avatar|deck|table|hat|wand|frame|title|emote|dice|winanim
  cost     int  not null check (cost >= 0),
  currency text not null default 'crystals' check (currency in ('crystals','gold')),
  rarity   text not null default 'common',   -- common|rare|epic|legendary|mythic
  active   boolean not null default true
);
alter table public.wizard_catalog enable row level security;
drop policy if exists catalog_read on public.wizard_catalog;
create policy catalog_read on public.wizard_catalog for select using (true);

-- --- Inventar ---------------------------------------------------------------
create table if not exists public.wizard_inventory (
  id          uuid primary key default gen_random_uuid(),
  uid         uuid not null references auth.users(id) on delete cascade,
  item_id     text not null,
  kind        text not null,
  acquired_at timestamptz not null default now(),
  unique (uid, item_id)
);
alter table public.wizard_inventory enable row level security;
drop policy if exists inv_read_own on public.wizard_inventory;
create policy inv_read_own on public.wizard_inventory
  for select using (uid = auth.uid());
create index if not exists idx_wizard_inventory_uid on public.wizard_inventory(uid);

-- --- Buchungslog (Audit; nur Definer-Funktionen schreiben) ------------------
create table if not exists public.wizard_ledger (
  id         uuid primary key default gen_random_uuid(),
  uid        uuid not null,
  d_crystals int not null default 0,
  d_gold     int not null default 0,
  reason     text not null,          -- buy_item | grant_iap | reward_game | open_chest | pass_reward
  ref        text,
  created_at timestamptz not null default now()
);
alter table public.wizard_ledger enable row level security;   -- keine Policy

-- ---------------------------------------------------------------------------
-- RPC: eigene Geldboerse + Inventar holen (legt die Boerse bei Bedarf an)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_wallet()
returns table(crystals int, gold int, inventory text[])
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.wizard_wallets(uid) values (v_uid) on conflict (uid) do nothing;
  return query
    select w.crystals, w.gold,
           coalesce((select array_agg(item_id)
                     from public.wizard_inventory where uid = v_uid), '{}')
    from public.wizard_wallets w where w.uid = v_uid;
end; $$;

-- ---------------------------------------------------------------------------
-- RPC: Kosmetik mit Waehrung kaufen. Preis/Waehrung kommen aus dem Katalog,
-- NICHT vom Client. Idempotent (Doppelkauf = "bereits im Besitz").
-- Rueckgabe: ok, neue Guthaben, Meldung.
-- ---------------------------------------------------------------------------
create or replace function public.wizard_buy_item(p_item_id text)
returns table(ok boolean, crystals int, gold int, message text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column   -- Rueckgabe-Spalte crystals/gold vs. Tabellenspalte
                                -- (sonst mehrdeutig im UPDATE, sobald Guthaben > 0)
declare
  v_uid  uuid := auth.uid();
  v_item public.wizard_catalog%rowtype;
  v_w    public.wizard_wallets%rowtype;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.wizard_wallets(uid) values (v_uid) on conflict (uid) do nothing;

  select * into v_item from public.wizard_catalog where item_id = p_item_id and active;
  if not found then
    return query select false, w.crystals, w.gold, 'Artikel nicht gefunden'
      from public.wizard_wallets w where w.uid = v_uid; return;
  end if;

  if exists (select 1 from public.wizard_inventory where uid = v_uid and item_id = p_item_id) then
    return query select true, w.crystals, w.gold, 'Bereits im Besitz'
      from public.wizard_wallets w where w.uid = v_uid; return;
  end if;

  select * into v_w from public.wizard_wallets where uid = v_uid for update;

  if v_item.currency = 'crystals' and v_w.crystals < v_item.cost then
    return query select false, v_w.crystals, v_w.gold, 'Nicht genug Kristalle'; return;
  elsif v_item.currency = 'gold' and v_w.gold < v_item.cost then
    return query select false, v_w.crystals, v_w.gold, 'Nicht genug Gold'; return;
  end if;

  update public.wizard_wallets set
    crystals   = crystals - case when v_item.currency='crystals' then v_item.cost else 0 end,
    gold       = gold     - case when v_item.currency='gold'     then v_item.cost else 0 end,
    updated_at = now()
  where uid = v_uid;

  insert into public.wizard_inventory(uid, item_id, kind)
    values (v_uid, p_item_id, v_item.kind);
  insert into public.wizard_ledger(uid, d_crystals, d_gold, reason, ref)
    values (v_uid,
      case when v_item.currency='crystals' then -v_item.cost else 0 end,
      case when v_item.currency='gold'     then -v_item.cost else 0 end,
      'buy_item', p_item_id);

  return query select true, w.crystals, w.gold, 'Gekauft'
    from public.wizard_wallets w where w.uid = v_uid;
end; $$;

-- --- Rechte: nur angemeldete Nutzer -----------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array['wizard_wallet()','wizard_buy_item(text)'] loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Migration wizard_table_prices_up (live angewandt): Spielfelder etwas teurer.
--   800 -> 1000, 1000 -> 1300, 1800 -> 2200, 2000 -> 2500 (kind='table')
-- ---------------------------------------------------------------------------
-- update public.wizard_catalog set cost = case cost
--   when 800 then 1000 when 1000 then 1300
--   when 1800 then 2200 when 2000 then 2500 else cost end
-- where kind = 'table' and active;
