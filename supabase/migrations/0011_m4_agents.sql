-- M4 Agents (screen 9). Every agent part of a plan gets one `agents` row, made the first time someone opens
-- the Agents view. Its settings (model, temperature, max tokens, instructions, tools, knowledge) are saved here.
-- Try it runs the agent for real on Lyzr Studio: `lyzr_agent_id` is the Studio agent made for this node (on its
-- first Try it or Save) and reused after. Each Try it is saved as an `agent_runs` row with the runtime it used.

alter table agents add column description text;
alter table agents add column temperature numeric not null default 0.3 check (temperature >= 0 and temperature <= 1);
alter table agents add column max_tokens int not null default 800 check (max_tokens between 100 and 4000);
alter table agents add column knowledge text[] not null default '{}';
alter table agents add column lyzr_agent_id text;
alter table agents add column created_at timestamptz not null default now();
alter table agents add column updated_at timestamptz not null default now();
alter table agents alter column model set default 'gemini';
-- One row per agent part of a project (item keys are stable across versions).
alter table agents add constraint agents_project_item unique (project_id, item_key);

-- Where a run ran: its own Studio agent, the shared Studio agent, or the model gateway (Simulated: no Lyzr key).
alter table agent_runs add column runtime text not null default 'gateway' check (runtime in ('lyzr_agent', 'lyzr_shared', 'gateway'));
alter table agent_runs add column model_label text;
alter table agent_runs add column created_by uuid references auth.users(id) on delete set null;
create index agent_runs_agent_time on agent_runs (agent_id, created_at desc);
