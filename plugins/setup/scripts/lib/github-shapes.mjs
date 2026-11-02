export const LABELS = [
  { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
  { name: 'proposal', color: '0e8a16', description: 'A proposed improvement or feature' },
  { name: 'severity:serious', color: 'b60205', description: 'Serious defect' },
  { name: 'severity:minor', color: 'fbca04', description: 'Minor defect' },
];

export const RULESET_NAME = 'main through pull requests';

export function rulesetBody(checks, ownerType) {
  const bypass = ownerType === 'Organization' ? { actor_id: 15368, actor_type: 'Integration' } : { actor_id: null, actor_type: 'DeployKey' };
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          allowed_merge_methods: ['merge', 'squash', 'rebase'],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: false,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          do_not_enforce_on_create: false,
          strict_required_status_checks_policy: false,
          required_status_checks: checks.map((context) => ({ context })),
        },
      },
    ],
    bypass_actors: [{ ...bypass, bypass_mode: 'always' }],
  };
}

export function keyScript(slug) {
  return `#!/usr/bin/env bash
set -euo pipefail
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "release-bot" -f "$dir/release-key"
gh repo deploy-key add "$dir/release-key.pub" --allow-write --title release-bot -R ${slug}
gh secret set RELEASE_DEPLOY_KEY -R ${slug} < "$dir/release-key"
rm -rf "$dir"
gh repo deploy-key list -R ${slug}
gh secret list -R ${slug}
`;
}
