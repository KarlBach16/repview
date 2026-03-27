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

If generated data files changed, it auto-commits and pushes with:

- `chore: daily data update`

Updated data files:

- `data/members.json`
- `data/raw/bills_raw.json`
- `data/raw/votes_raw.json`
- `data/app/representatives.json`

## Required Secret

Set this repository secret in GitHub:

- `ASSEMBLY_API_KEY`

Path: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**
