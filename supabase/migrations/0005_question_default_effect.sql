-- Architect 2.0 prototype · What each question's recommended answer does to what was asked for.
-- The model labels it; the server decides from it which questions hold Build (A-0, A-2).
alter table questions
  add column default_effect text not null default 'keep' check (default_effect in ('keep', 'reduce', 'remove', 'none'));

-- Questions written before this were blocking only when there was no safe default.
update questions set default_effect = 'none' where blocking;
