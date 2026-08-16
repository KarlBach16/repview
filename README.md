# RepView

RepView is a static web app that visualizes South Korean National Assembly member activity.

## Daily Auto Update (GitHub Actions)

This repository includes a workflow at `.github/workflows/update-data.yml` that runs:

- every day at **03:00 KST**
- manually via **workflow_dispatch**

The workflow runs these scripts in order:

1. `node scripts/fetchMembers.js`
2. `node scripts/fetchBills.js`
3. `node scripts/fetchVotes.js`
4. `node scripts/buildRepresentatives.js`
5. `node scripts/buildBillDetails.js`
6. `node scripts/testBillDetails.js`
7. `node scripts/fetchKRSupporterAssociations.js`
8. `node scripts/auditDataQuality.js`

If generated data files changed, it auto-commits and pushes with:

- `chore: daily data update`

Updated data files:

- `data/members.json`
- `data/kr/collaboration_networks.json`
- `data/kr/vote_similarity.json`
- `data/kr/supporter_associations.json`
- `data/kr/bills/*.json`
- `data/raw/bills_raw.json`
- `data/raw/vote_summaries.json.gz`
- `data/raw/votes_raw.json.gz`
- `data/app/representatives.json`

The US House workflow at `.github/workflows/update-us-house.yml` also refreshes
`data/us/collaboration_networks.json` from GovInfo's BILLSTATUS bulk data and
`data/us/vote_similarity.json` from Voteview's House roll-call bulk data.

## Required Secret

Set this repository secret in GitHub:

- `ASSEMBLY_API_KEY`

Path: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**
