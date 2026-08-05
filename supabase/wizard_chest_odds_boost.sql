-- ============================================================================
-- Truhen: Item-Chancen anheben (bessere gefuehlte Wertigkeit)
-- ----------------------------------------------------------------------------
-- Problem: selbst die teuerste Diamanttruhe (2000 Kristalle) hatte nur ~55,6 %
-- Chance auf ueberhaupt EINE Kosmetik; der Rest war Kristalle/Gold zurueck ->
-- fuehlt sich wie ein Nullsummenspiel an. Diese Migration erhoeht NUR die
-- Item-Chance je Belohnung (item_pct) moderat. Die Kristall-/Goldmengen und die
-- Drop-Anzahl je Truhe bleiben unveraendert, ebenso die Obergrenze von max. 2
-- Kosmetik-Items je Truhe (Parameter p_no_item aus wizard_open_chest). Dadurch
-- bleibt die Kristall-Oekonomie stabil, ein Kauf lohnt sich aber spuerbar mehr.
--
-- Alte -> neue Item-Chance je Belohnung:
--   holz    2,5 % -> 4 %      silber  5 % -> 9 %
--   gold    9 %   -> 15 %     diamant 15 % -> 24 %
--
-- Daraus ergibt sich die Chance auf >=1 Kosmetik je Truhe (1-(1-p)^drops):
--   holz    ~7,8 %   (Drops 2)     silber  ~24,6 %  (Drops 3)
--   gold    ~47,8 %  (Drops 4)     diamant ~74,6 %  (Drops 5)
--
-- DEPLOY: Diese Datei ersetzt per CREATE OR REPLACE nur die Funktion
-- public._wiz_roll_drop (dieselbe Signatur wie live). wizard_open_chest,
-- wizard_spin_chest usw. bleiben unangetastet. Nach dem Deploy stimmen die im
-- Client angezeigten Chancen (CHEST_ODDS in app.js) wieder mit dem Server
-- ueberein. Reihenfolge egal; keine Datenmigration noetig.
-- ============================================================================

create or replace function public._wiz_roll_drop(p_uid uuid, p_rarity text, p_no_item boolean, p_skip text[])
returns jsonb
language plpgsql
as $function$
declare
  r double precision := random();
  item_pct double precision;
  amt int; it record;
begin
  -- NEU: angehobene Item-Chancen (vorher 0.025 / 0.05 / 0.09 / 0.15).
  item_pct := case p_rarity when 'holz' then 0.04 when 'silber' then 0.09
                            when 'gold' then 0.15 else 0.24 end;
  if not p_no_item and random() < item_pct then
    select cat.item_id as iid, cat.kind as knd into it
    from public.wizard_catalog cat
    where cat.active
      -- 'title' bewusst raus: Titel haben keine Shop-/Reveal-Ansicht im Client
      -- (findCatalogItem kennt sie nicht) -> sonst rohe Kennung im Reveal.
      and cat.kind in ('avatar','deck','table','back')
      and not (cat.item_id = any(p_skip))
      and not exists (select 1 from public.wizard_inventory i
                      where i.uid = p_uid and i.item_id = cat.item_id)
    order by (random() * case cat.rarity
        when 'legendary' then case p_rarity when 'diamant' then 4.0 when 'gold' then 3.0 else 1.0 end
        when 'epic'      then case p_rarity when 'diamant' then 3.0 when 'gold' then 3.5 when 'silber' then 2.5 else 1.2 end
        when 'rare'      then case p_rarity when 'holz' then 3.0 when 'silber' then 3.0 else 1.5 end
        else                  case p_rarity when 'holz' then 3.0 else 1.0 end
      end) desc
    limit 1;
    if found then
      return jsonb_build_object('t','item','item_id',it.iid,'kind',it.knd);
    end if;
  end if;

  -- Kein Item -> Waehrung. 60% Kristalle, 40% Gold (unveraendert).
  if r < 0.60 then
    amt := case p_rarity
      when 'holz'   then case when random()<0.70 then 6+floor(random()*10)::int
                              when random()<0.83 then 16+floor(random()*15)::int
                              when random()<0.98 then 31+floor(random()*30)::int
                              else 80+floor(random()*81)::int end
      when 'silber' then case when random()<0.65 then 12+floor(random()*19)::int
                              when random()<0.80 then 31+floor(random()*30)::int
                              when random()<0.97 then 61+floor(random()*60)::int
                              else 200+floor(random()*151)::int end
      when 'gold'   then case when random()<0.60 then 20+floor(random()*36)::int
                              when random()<0.78 then 56+floor(random()*55)::int
                              when random()<0.96 then 111+floor(random()*110)::int
                              else 400+floor(random()*301)::int end
      else               case when random()<0.55 then 40+floor(random()*51)::int
                              when random()<0.75 then 91+floor(random()*90)::int
                              when random()<0.95 then 181+floor(random()*170)::int
                              else 700+floor(random()*501)::int end
    end;
    return jsonb_build_object('t','crystals','n',amt);
  else
    amt := case p_rarity
      when 'holz'   then 10+floor(random()*21)::int
      when 'silber' then 20+floor(random()*41)::int
      when 'gold'   then 40+floor(random()*81)::int
      else               80+floor(random()*161)::int
    end;
    return jsonb_build_object('t','gold','n',amt);
  end if;
end; $function$;
