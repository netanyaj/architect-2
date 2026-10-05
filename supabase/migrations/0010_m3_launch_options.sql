-- M3 Launch options (reviews/deploy-flow-review-2026-10-05.md), all simulated:
-- who can open the app, analytics, the Marketplace listing and custom domains live in one settings object per
-- project; the test version can be shared by a view-only link; a deploy can fail (the previous version stays live).

alter table projects add column launch_settings jsonb not null default '{}';
alter table projects add column test_share_token uuid unique;

alter table deployments drop constraint deployments_status_check;
alter table deployments add constraint deployments_status_check
  check (status in ('checking', 'blocked', 'deploying', 'live', 'rolled_back', 'failed'));
