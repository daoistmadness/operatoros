# OCI release authorization and evidence

This runbook describes the gated GHCR publisher. It does not authorize
publication. The repository variable `OPERATOROS_ENABLE_GHCR_PUBLISH` must
remain `false` until the governance blockers below have an owner-approved,
technically enforced resolution.

## Publisher evidence contract

The manual `publish-oci.yml` workflow requires four inputs:

- `source_commit`: the full SHA of the `main` commit running the publisher.
- `ci_run_id`: the successful `main` push run that built the OCI archive.
- `full_release_run_id`: a successful scheduled or manual full-release run for
  that exact commit.
- `release_version`: the release label recorded in the manifest.

The validation job uses only read permissions. It verifies the repository ID
and name, the active `.github/workflows/ci.yml` workflow ID and path, and both
run IDs. The build run must be a completed successful `push` on `main` at the
exact source SHA. Its current attempt must have successful `api`, `frontend`,
and `podman-images` jobs. Exactly one unexpired, non-empty OCI artifact must
match the expected source SHA and run attempt. Artifact metadata must identify
the same repository, `main` branch, source SHA, and CI run. The validated
artifact ID is passed to `actions/download-artifact` so the publish job
downloads that immutable artifact identity rather than resolving by name.

The full-release run must come from the same trusted workflow and repository,
run on `main` at the same SHA, and complete successfully. The current run
attempt must contain exactly one completed, successful `Full release
validation` job. A skipped job, failed run, PR run, other workflow, other
repository, or stale source SHA is rejected. No age cutoff is applied to a
successful full-release run for the identical source commit; the build artifact
must still be unexpired. If it has expired, build a fresh artifact from the
approved source SHA and provide the matching successful CI run ID.

The publishing script independently validates all archive/SBOM files and
checksums, derives the OCI manifest digests from the verified archives, loads
both images before a push, uses Skopeo digest preservation, compares registry
digests, pulls each image by digest, and creates the release manifest only
after both images verify. These checks do not provide an independent human
approval or pre-publication cryptographic provenance.

## Current governance status

As checked on 2026-10-14:

- The repository is private and owned by the personal account
  `daoistmadness`.
- The personal account's Billing overview showed GitHub Free. This is a
  read-only plan check; payment information is outside this review.
- The `oci-publish` environment allows only `main`. Its API protection rules
  contain only `branch_policy`; `can_admins_bypass` is `false`. The settings
  page shows no required-reviewer controls or configured reviewers. Therefore
  an approval is **not enforced** by this environment. The API has no
  `prevent_self_review` value because no reviewer rule is configured. The
  `can_admins_bypass=false` value does not create an approval gate.
- The GitHub rulesets page states that the configured `main` ruleset will not
  be enforced on this private repository until it is moved to a GitHub Team
  organization account. The classic branch-protection page says no classic
  rules are configured. REST API 403 responses are not treated as evidence of
  enforcement or absence; the UI is the evidence for the current state.
- `OPERATOROS_ENABLE_GHCR_PUBLISH` is `false`. No GHCR image has been published
  by this workflow.

### CodeQL publication gate status (2026-10-14)

The publisher requires a successful `CodeQL` check on the exact merged pull
request head. Its observed check identity is `github-advanced-security`;
API, frontend, Podman, and E2E checks are GitHub Actions checks. The publisher
now validates the complete check-run response, exact head SHA, latest result,
conclusion, expected GitHub App identity, and for Actions checks, the linked
workflow ID/path and exact successful job ID/name. Missing CodeQL evidence
remains a hard failure.

On PR #233 head
`b6a0b211e8634fec752d1f952d76acb43ff31abd`, API, frontend, Podman, and E2E
checks passed, but there was no CodeQL check. Full release validation was
skipped on that PR run by design. A historical successful CodeQL check on an
older PR proves the check identity, not current-commit coverage. The
Code-scanning default-setup API returned HTTP 403 with the specific message
“Code scanning is not enabled for this repository.” No CodeQL workflow or run
exists for current `main` or the PR #233 head.

This is a repository capability/setup blocker, not a check-name mismatch.
Do not remove CodeQL from the publisher's required checks. The account Billing
overview shows GitHub Free; GitHub requires Team or Enterprise plus GitHub Code
Security for private-repository code scanning. Because the repository is
currently under a personal account, CodeQL availability requires an eligible
organization/subscription and repository enablement. The Code Security price
and exact active-committer charge have not been obtained. Do not add a local
workflow that claims GitHub CodeQL coverage as a substitute. Keep publication
blocked until eligibility is confirmed, the feature is enabled, and a
successful `CodeQL` check is observed on the exact source PR head.

GitHub documents required environment reviewers for private repositories as
an Enterprise Cloud feature; on Free, Pro, and Team plans the reviewer rule is
limited to public repositories. GitHub artifact attestations for private
repositories also require Enterprise Cloud. Do not make this student-data
application public to obtain those features.

### Approval options for an owner decision

1. **GitHub-native protection:** move the private repository to an
   organization on GitHub Enterprise Cloud, purchase/enable GitHub Code
   Security, and assign a separate trusted human/team as an `oci-publish`
   reviewer. Enable prevent-self-review, keep admin bypass off, restrict the
   environment to `main`, and configure enforced branch rules. This is the
   documented GitHub-native path that covers private-repo environment
   reviewers and private artifact attestations while enabling CodeQL. The
   account currently shows GitHub Free. Enterprise lists at $21 USD per
   user/month for the first 12 months; Code Security is a separate usage-based
   or subscription SKU measured by unique active committers over 90 days.
   Exact Code Security price, enterprise quote, seat count, and discounts are
   not verified. A second independent reviewer also creates an ongoing
   identity and availability requirement.
2. **Custom deployment protection rule:** GitHub Apps can supply a separate
   approval service, but private repositories require GitHub Enterprise and
   the feature is in public preview. The app needs Actions read-only and
   Deployments read/write permissions, a protected endpoint, webhook
   validation, installation-token handling, monitoring, and recovery. It
   still needs an independent approver. This is unavailable on the current
   GitHub Free account and is not selected.
3. **External signed release authorization:** a distinct independent approver
   signs a canonical authorization binding source SHA, successful full-release
   run, artifact ID/digest, and release version. The publisher verifies
   against a trust root outside the same repository write path. This can
   replace the GitHub environment reviewer only if an independent signer and
   protected signing key/service exist; neither currently exists. It requires
   key custody, rotation, revocation, recovery, and reviewer operations. The
   sole maintainer signing their own release is not independent approval. A
   checkbox, repository variable, tag, or signature produced by the publishing
   job itself is not an approval boundary.

No alternative is enabled by this change. The owner must select a governance
model, confirm an independent reviewer identity, and authorize any plan or
repository-ownership change separately.

## Cryptographic provenance policy

**Policy decision: OPEN. Recommended minimum before first GHCR publication:
pre-publication, cryptographically verifiable provenance for the exact OCI
archives and SBOMs is required.** The publisher's existing GitHub attestations
are created after the registry push; they do not authenticate the input
archives before that push. OCI source/revision labels and checksum files are
useful metadata/integrity checks, but they are not signed provenance.

Options to evaluate:

- **GitHub artifact attestations:** use `actions/attest` in the trusted build
  workflow to attest the archive/SBOM subjects, then verify them before any
  GHCR push with `gh attestation verify`, pinning repository and signer
  workflow. This is the simplest GitHub-native route, but private repositories
  require GitHub Enterprise Cloud. It needs narrowly scoped `id-token: write`
  and `attestations: write` on the trusted artifact-producing job and adds
  workflow maintenance. Current GHCR attestations are created after the
  registry push; they do not attest the input archives before publication.
- **Sigstore/Cosign keyless blob signatures:** sign a canonical evidence file
  (including archive/SBOM hashes, source SHA, run and workflow identity) with
  GitHub Actions OIDC, retain the Sigstore bundle beside the artifact, then
  verify the blob and exact certificate identity/issuer before publication.
  Cosign supports keyless blob signing and bundles without a repository
  package-write credential. This is technically feasible to prototype without
  publishing, but it introduces a pinned Cosign tool, `id-token: write` on a
  trusted main-only job, public Fulcio/Rekor service availability, bundle
  retention, identity-policy maintenance, and transparency-log metadata
  exposure. It proves which workflow identity signed the evidence; it does not
  provide independent human approval and is not implemented or accepted yet.

Choose and rehearse one mechanism with disposable fixture artifacts before
making it a required release gate. Do not treat post-push image attestations as
a substitute for pre-push artifact verification.

## Partial-push recovery

The API image may be pushed successfully before the web push fails. In that
case the workflow fails; it must not create a release manifest, run the later
attestation steps, or trigger deployment. The publisher logs both the verified
archive digest and any registry digest that passed pull-by-digest verification.

For a partial push:

1. Record the exact `ghcr.io/daoistmadness/<image>@sha256:...` digest from the
   failed publisher job and confirm the registry object by that digest.
2. Treat the run as failed. Do not deploy the image or construct a release
   manifest from partial output.
3. Check whether the exact digest is referenced by a release manifest or any
   deployment. Do not delete a package, tag set, or all unreferenced images.
4. If cleanup is appropriate, request maintainer review and remove only the
   exact orphan digest using a registry operation that targets that object.
   Keep the run logs and CI artifact evidence. Never automate broad cleanup.
5. Resolve the cause, then start a new authorized release attempt using the
   same verified source commit and a still-valid CI artifact, or build a fresh
   artifact if it expired.

If the digest cannot be confirmed, preserve the package and stop for manual
registry investigation. Do not guess which manifest an ambiguous registry
record represents.

## Current evidence snapshot

- Source commit: `477ff837e20d75b4b1860a38b93bde97b7435c04`.
- Main OCI build run: `38498943364` (push; successful build jobs; full-release
  job was skipped by design).
- Full-release run: `38499391277` (manual; successful `Full release validation`
  job; other CI jobs were skipped by design).
- OCI artifact: `operatoros-oci-477ff837e20d75b4b1860a38b93bde97b7435c04-1`,
  artifact ID `11864987173`, currently unexpired with stated expiry
  `2026-10-21T02:07:05Z`. The artifact-service digest is not an OCI image
  digest.
- No GHCR image digest exists for this release because it has not been
  published.

The current source artifact and full-release run bind to the same source SHA.
Before a future publication attempt, the publisher must re-fetch and revalidate
both run records and the artifact; this snapshot is not authorization.

## References

- [GitHub deployment environments and reviewer plan limits](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Code scanning availability for private repositories](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement)
- [GitHub Code Security licensing and active-committer billing](https://docs.github.com/en/billing/concepts/product-billing/github-advanced-security)
- [Custom deployment protection rule eligibility and requirements](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/create-custom-protection-rules)
- [GitHub artifact attestations and private-repository plan limits](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub pricing](https://github.com/pricing)
- [Sigstore blob signing](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/)
- [Sigstore CI quickstart](https://docs.sigstore.dev/quickstart/quickstart-ci/)
