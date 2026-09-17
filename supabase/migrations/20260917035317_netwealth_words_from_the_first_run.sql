-- The words Netwealth actually uses, from the first real run (17 Sep 2026)
--
-- The class map was seeded a few hours ago with one observed word and
-- seventeen exact-string guesses, each marked observed = false, on the promise
-- that the first real run would say which were right. It did: 176 sandbox
-- accounts landed, 53 of them carrying an allocation, using nine distinct
-- words. This migration is the receipt.
--
--   Seen and already mapped:   Australian Fixed Interest (52), Australian Equities (29),
--                              International Equities (20), Property (17),
--                              International Fixed Interest (4), Other (4)
--   Seen and NOT in the map:   Alternative Investments (10), Multi Sector (5),
--                              International Unhedged (1)
--
-- Two of the three are added here. "Alternative Investments" is the word the
-- guesses "Alternatives"/"Alternative" were reaching for, and goes to `other`
-- as they did. "Multi Sector" is a diversified fund spanning classes with no
-- single home in the CRM's eight; `other` is the honest answer until Netwealth
-- reports its split. "International Unhedged" is left OUT deliberately: it
-- could be equities or fixed interest, one account carries it, and a wrong row
-- here would be written into that account's allocation on every run. The
-- tripwire will name it in that account's note the day it is linked, and the
-- decision is a person's. Nothing was matched on this run — no Netwealth
-- account is linked yet — so no allocation has been written from any of this.

update ingest.netwealth_asset_class_map
   set observed = true,
       note     = concat_ws(' ', note, 'Seen on the first real run, 17 Sep 2026')
 where netwealth_class in ('Australian Equities', 'International Equities', 'Property',
                           'International Fixed Interest', 'Other');

insert into ingest.netwealth_asset_class_map (netwealth_class, crm_class, observed, note) values
  ('Alternative Investments', 'other', true,
     'Seen on the first real run, 17 Sep 2026 (10 accounts). The word the seeded guesses Alternatives/Alternative were reaching for'),
  ('Multi Sector',            'other', true,
     'Seen on the first real run, 17 Sep 2026 (5 accounts). A diversified fund spanning classes; no single home in the CRM''s eight, so other until Netwealth reports the split')
on conflict (netwealth_class) do nothing;

comment on table ingest.netwealth_asset_class_map is
  'What Netwealth calls an asset class, mapped to the CRM''s eight. A word with no row skips the allocation for that account and is named in the landing row''s note (allocation_unmapped). observed = true means the word has arrived from a real account; false marks a 17 Sep 2026 guess that has not. "International Unhedged" is known to exist (one sandbox account) and is deliberately unmapped pending a decision.';
