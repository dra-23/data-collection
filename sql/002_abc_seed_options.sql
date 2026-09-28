-- ABC Data Collection — option lists and functions (reference data only)
-- Run 2nd, after 001_abc_schema.sql.
--
-- Contains no student data. Safe to re-run: existing rows are left as-is
-- (on conflict do nothing), so edits made in the dashboard are never
-- overwritten. To change a label later, edit it in the Table Editor —
-- recorded entries store the code, not the label.
--
-- `narrative` is the clause used in the draft Antecedents/Consequences
-- paragraphs; antecedent clauses follow "when ...", consequence clauses
-- follow "s/he ...". Wording is a starting point — edit freely.

begin;

insert into abc_options (category, code, label, hint, narrative, has_text, display_order) values
  -- Activity (single select)
  ('activity', 'act_independent',  'Independent Work',              '', '', false, 1),
  ('activity', 'act_small_group',  'Small Group Work',              '', '', false, 2),
  ('activity', 'act_large_group',  'Large Group Work',              '', '', false, 3),
  ('activity', 'act_free_time',    'Free Time - No Expectations',   '', '', false, 4),
  ('activity', 'act_lunch',        'Lunch',                         '', '', false, 5),
  ('activity', 'act_recess',       'Recess',                        '', '', false, 6),
  ('activity', 'act_special',      'Special',                       '', '', true,  7),
  ('activity', 'act_other',        'Other',                         '', '', true,  8),

  -- Antecedents (multi-select: what happened immediately before)
  ('antecedent', 'ant_removal_attention', 'Removal of Attention',  '',                               'adult attention was removed',                 false, 1),
  ('antecedent', 'ant_demand',            'Given Demand/Work',     '',                               's/he was given a demand or work',             false, 2),
  ('antecedent', 'ant_correction',        'Given Correction',      '',                               's/he was given a correction',                 false, 3),
  ('antecedent', 'ant_peer_provoked',     'Peer(s) provoked',      '',                               's/he was provoked by peers',                  false, 4),
  ('antecedent', 'ant_environment',       'Environment',           'sound, light, quick movement',   'there was an environmental trigger (sound, light, or quick movement)', false, 5),
  ('antecedent', 'ant_item_denied',       'Item removed/denied',   '',                               'an item was removed or denied',               false, 6),
  ('antecedent', 'ant_transition',        'Transition',            '',                               's/he was transitioning between activities',   false, 7),
  ('antecedent', 'ant_alone',             'Alone/Doing Nothing',   '',                               's/he was alone or doing nothing',             false, 8),
  ('antecedent', 'ant_other',             'Other',                 '',                               '',                                            true,  9),

  -- Consequences (multi-select: what happened immediately after)
  ('consequence', 'cons_adult_attention',   'Adult Attention',               'response block, told "no", followed, etc.', 'received adult attention',                         false, 1),
  ('consequence', 'cons_peer_attention',    'Peer Attention/reaction',       'yelled, aggression back, etc.',             'received peer attention or a reaction',            false, 2),
  ('consequence', 'cons_terminated_demand', 'Terminated Demand',             'allowed escape, break, etc.',               'had the demand terminated (e.g., allowed to escape or take a break)', false, 3),
  ('consequence', 'cons_ignored',           'Ignored',                       'no attention to negative behavior',         'was ignored',                                      false, 4),
  ('consequence', 'cons_redirected',        'Redirected to another activity','',                                          'was redirected to another activity',               false, 5),
  ('consequence', 'cons_demand_followed',   'Demand followed through',       '',                                          'had the demand followed through',                  false, 6),
  ('consequence', 'cons_preferred_item',    'Given Preferred Item/Activity', '',                                          'was given a preferred item or activity',           false, 7),
  ('consequence', 'cons_staff_walked_away', 'Staff walked away',             '',                                          'had staff walk away',                              false, 8),
  ('consequence', 'cons_other',             'Other',                         '',                                          '',                                                 true,  9)
on conflict (code) do nothing;

insert into abc_functions (code, label, fba_phrase, display_order) values
  ('sensory',   'Sensory',         'for sensory reinforcement', 1),
  ('escape',    'Escape',          'to escape',                 2),
  ('attention', 'Attention',       'for attention',             3),
  ('tangible',  'Tangible Access', 'for tangible access',       4)
on conflict (code) do nothing;

commit;
