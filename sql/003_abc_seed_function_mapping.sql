-- ABC Data Collection — function mapping (reference data only)
-- Run 3rd, after 002_abc_seed_options.sql.
--
-- Mirrors the paper form's scoring table. An option may count toward more
-- than one function. "Other" antecedents/consequences and all activities
-- are intentionally unmapped — they're tallied but don't score a function.
-- Contains no student data. Safe to re-run (on conflict do nothing).
--
-- | Function  | Antecedents                                        | Consequences                                              |
-- |-----------|----------------------------------------------------|-----------------------------------------------------------|
-- | Sensory   | Peer(s) provoked; Environment; Alone/Doing Nothing | Ignored; Staff walked away                                |
-- | Escape    | Given Demand/Work; Given Correction;               | Terminated Demand; Staff walked away                      |
-- |           | Peer(s) provoked; Transition                       |                                                           |
-- | Attention | Removal of Attention; Alone/Doing Nothing          | Redirected; Adult Attention; Peer Attention/reaction;     |
-- |           |                                                    | Demand followed through                                   |
-- | Tangible  | Item removed/denied                                | Redirected; Given Preferred Item/Activity                 |

begin;

insert into abc_function_mapping (function_code, option_code) values
  ('sensory',   'ant_peer_provoked'),
  ('sensory',   'ant_environment'),
  ('sensory',   'ant_alone'),
  ('sensory',   'cons_ignored'),
  ('sensory',   'cons_staff_walked_away'),

  ('escape',    'ant_demand'),
  ('escape',    'ant_correction'),
  ('escape',    'ant_peer_provoked'),
  ('escape',    'ant_transition'),
  ('escape',    'cons_terminated_demand'),
  ('escape',    'cons_staff_walked_away'),

  ('attention', 'ant_removal_attention'),
  ('attention', 'ant_alone'),
  ('attention', 'cons_redirected'),
  ('attention', 'cons_adult_attention'),
  ('attention', 'cons_peer_attention'),
  ('attention', 'cons_demand_followed'),

  ('tangible',  'ant_item_denied'),
  ('tangible',  'cons_redirected'),
  ('tangible',  'cons_preferred_item')
on conflict do nothing;

commit;

-- Verify (run separately): expect 5 / 6 / 6 / 3 rows.
--   select function_code, count(*) from abc_function_mapping
--   group by function_code order by function_code;
