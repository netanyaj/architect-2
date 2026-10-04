-- Architect 2.0 prototype · Gemini is the default model, and a plan can stop because the model was too slow.

alter table projects alter column model set default 'gemini';

-- OpenRouter's free models get 45 s; past that the plan pauses with "Switch model" (error kind "slow").
alter table blueprints drop constraint if exists blueprints_error_kind_check;
alter table blueprints add constraint blueprints_error_kind_check check (error_kind in ('rate_limited', 'invalid', 'unavailable', 'slow'));
