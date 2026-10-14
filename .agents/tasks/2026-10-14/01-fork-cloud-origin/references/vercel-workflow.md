# GitHub Actions deployment to Vercel

**Updated:** 2026-10-14
**State:** source implemented; live settings and deployment remain unverified.

## Confirmed target

The user selected W3Dev/vercel-deploy for the fork's GitHub Actions deployment and required literal, hardcoded identifiers:

| Field | Value |
| --- | --- |
| Repository | ashutoshpw/cmux |
| Production domain | https://cmux.w3dev.app |
| Vercel team/org ID | team_bhbVYR6BqVYMXKwAp7F1k5ib |
| Vercel project ID | prj_3z4VuRVvSvlm5LYNnEuqHa4FKKtn |
| Planned workflow | .github/workflows/deploy-vercel.yml |
| Action | W3Dev/vercel-deploy |
| Credential | GitHub secret VERCEL_TOKEN |

The two IDs are nonsecret configuration. Keep them literal in the workflow's vercel_org_id and vercel_project_id inputs; do not turn them into optional variables or inherited upstream defaults. Retarget deployment audits, environment pulls, smoke tools and the nonsecret deployment manifest to the same supplied target. Do not infer a team slug or project name from the IDs.

These identifiers are user supplied. Live project membership, settings, domain assignment, token availability and deploy permissions have not been verified.

## Verified action interface

Inspected action.yml and README.md from W3Dev/vercel-deploy on 2026-10-14. Current main resolved to c07189acacfbd8e9416ee8e9e98f8925de13a718, and the input definition at that exact SHA was checked. Pin that immutable reviewed revision for implementation, or explicitly review and record a newer revision before choosing it.

The action accepts vercel_token, vercel_org_id, vercel_project_id, working_directory, package_manager, package_manager_version, node_version, vercel_cli_version, install_command, prebuild_script, predeploy_script and environment. It installs dependencies, links the supplied project, pulls the selected Vercel environment, runs vercel build, and deploys the resulting prebuilt output. It exposes deployment_url and alias_url outputs.

Use environment: production explicitly: the action defaults to preview. Set install_command explicitly: its default Bun path runs bun install without --frozen-lockfile.

## Workflow design

- Production triggers: push to the fork's main branch and workflow_dispatch on main.
- Guard the production job to github.repository == ashutoshpw/cmux and github.ref == refs/heads/main.
- Use an owned/supported runner; ubuntu-24.04 is the planning default. No upstream private fleet dependency is required.
- Pin checkout and deploy action revisions; pin Node, Bun and Vercel CLI versions.
- Use Bun 1.4.2 and Node 22 as pinned in the fork workflow.
- Use a stable production concurrency group with cancel-in-progress: false so an in-progress publication is not interrupted.
- Use contents: read. Production-only deployment does not require PR-comment write permission.
- Require the relevant web validation to pass before publication. Reuse the repository's web change/dependency selection when configuring push paths rather than deploying for unrelated native changes.
- Keep database migrations in the protected migration workflow; do not put them in Vercel build/startup or this action's build hook.
- Attach the primary domain to the supplied Vercel project and configure canonical application/auth environment values there.
- Make this workflow the deployment owner. Verify and disable duplicate automatic Git deployments through the Vercel project/Git deployment policy while retaining useful repository metadata linkage.
- Capture the action's deployment_url and inspect the actual deployed source SHA, project/team identity and primary-domain routing. A successful action alone does not establish authenticated Cloud behavior.

## Root directory alignment

Keep Vercel's project Root Directory set to web. Invoke the action from the repository root (working_directory: .), link .vercel there, and explicitly install/check the web package via cd web. This avoids selecting web twice through both a web action cwd and a web project Root Directory. Verify the actual Vercel build root from its pulled project settings and build logs before enabling production triggers.

Configure the project's Build Command to use the existing web vercel-build script. Ensure the Vercel build can read required source outside web, including the root relay config and changelog. Inspect the project's source-outside-root setting and include the required inputs in the workflow's change scope.

## Proposed action step

The executable workflow is .github/workflows/deploy-vercel.yml. The full workflow adds checkout, branch/repo guard, triggers, dependency scope, concurrency and required validation.

```yaml
- name: Deploy cmux web to Vercel
  id: deploy
  uses: W3Dev/vercel-deploy@c07189acacfbd8e9416ee8e9e98f8925de13a718
  with:
    vercel_token: ${{ secrets.VERCEL_TOKEN }}
    vercel_org_id: team_bhbVYR6BqVYMXKwAp7F1k5ib
    vercel_project_id: prj_3z4VuRVvSvlm5LYNnEuqHa4FKKtn
    working_directory: .
    package_manager: bun
    package_manager_version: '1.4.2'
    node_version: '22'
    vercel_cli_version: '54.6.1'
    install_command: cd web && bun install --frozen-lockfile
    environment: production
```

A token must have access to this team/project. Runtime secrets remain in the appropriate Vercel production/preview environments. If Better Auth is selected, configure BETTER_AUTH_URL, BETTER_AUTH_SECRET, database credentials and chosen email/OAuth settings there; Better Auth has been adopted.

No staging project IDs were supplied. Configure and verify a separate staging target or isolated preview settings before adding staging/PR deployment jobs; do not reuse production credentials or databases implicitly. Preview comment permissions and branch conditions should be scoped to that later job.

## Acceptance evidence

- Workflow uses the required action and contains both exact literal target IDs.
- Production runs only for the intended repository/main revision and only after applicable validation.
- Action inputs match the pinned action definition; frozen dependency install and root-directory alignment are exercised in a build.
- Vercel API/project settings confirm the supplied project belongs to the supplied team and has the expected root/domain/environment configuration.
- Duplicate deployment triggers are resolved in live project settings, not inferred from repository source alone.
- Deployment output and live domain identify the expected revision; auth and VM smoke checks use cmux.w3dev.app.
- Neither missing credentials nor deployment failure can select an upstream team/project/domain.

## Sources

- [Pinned action.yml](https://github.com/W3Dev/vercel-deploy/blob/c07189acacfbd8e9416ee8e9e98f8925de13a718/action.yml)
- [Action README](https://github.com/W3Dev/vercel-deploy/blob/c07189acacfbd8e9416ee8e9e98f8925de13a718/README.md)
