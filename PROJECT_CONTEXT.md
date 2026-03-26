좋다. 아래 내용은 **프로젝트 루트에 그대로 넣는 PROJECT_CONTEXT.md**이다.
목적은 다른 AI 모델(Claude, GPT 등)이 이 프로젝트를 즉시 이해하도록 하는 것이다.

이 문서는 제품 철학 + 구조 + 개발 규칙을 모두 담는다.

⸻

PROJECT_CONTEXT.md

# RepView – Project Context

## Overview

RepView is a visual web platform that allows users to search for their political representative and clearly see what they actually do in parliament.

Most parliamentary websites are difficult for ordinary citizens to navigate. Data is fragmented, interfaces are cluttered, and it is hard to understand what a representative actually does.

RepView solves this problem through a **visual-first interface** that emphasizes clarity, minimalism, and large-scale data presentation.

Instead of complex dashboards or tables, RepView uses **Apple-style visual storytelling** to present parliamentary activity.

---

# Core Concept

RepView presents parliamentary activity like an **Apple keynote presentation about a politician**.

Design philosophy:

- minimal interface
- large typography
- large portrait images
- scroll-based storytelling
- big number statistics

The representative is treated as the **primary visual subject**, similar to how Apple presents a product.

---

# Core User Question

The entire product answers a single question:

**“What is my representative actually doing in parliament?”**

Users should be able to see this within seconds.

---

# Key Features

## 1. Representative Search

Users can search by:

- representative name
- district
- country

Example queries:

Gangnam
Seoul
AOC
California 14
UK MP

Search returns a list of representatives as **large portrait cards**.

---

## 2. Representative Page

Each representative has a dedicated page.

The page uses **Apple-style scroll sections**.

Structure:

Hero
↓
Attendance
↓
Vote Participation
↓
Bills Proposed
↓
Recent Votes

Each section typically occupies **one full screen height (100vh)**.

---

## Hero Section

Displays:

- representative portrait
- name
- district
- party
- country

The portrait should dominate the layout.

---

## Big Number Sections

Representative activity is displayed through large numbers.

Examples:

92%
Attendance

88%
Vote Participation

3
Bills Proposed

Large typography is used to emphasize clarity.

---

## Recent Votes

A simple list of recent parliamentary votes.

Example:

Pension Reform Bill
YES

Education Budget
NO

This section prioritizes readability over density.

---

# UX Principles

RepView follows several strict UX rules.

## Search First

Navigation is based on search.

Avoid dropdown selectors.

Users should be able to directly type:

- name
- district
- country

---

## Image First

Representatives must be presented using **large portrait photos**.

Avoid small avatars or directory-style UI.

Portrait ratio recommended:

4:5

---

## Big Numbers

Representative performance is communicated using **large statistics**, not tables.

---

## Minimal UI

Avoid clutter.

RepView intentionally avoids:

- dashboards
- complex filters
- data tables
- dense charts

Clarity is the goal.

---

# Design Direction

The UI should resemble **Apple product pages**.

Key characteristics:

- large hero sections
- extreme whitespace
- cinematic presentation
- smooth scrolling
- minimal UI chrome

Think of the site as a **visual narrative about a politician**.

---

# Technical Stack

Initial MVP uses a simple stack.

HTML
CSS
Vanilla JavaScript
JSON data

Frameworks are intentionally avoided at this stage.

The goal is rapid iteration and design experimentation.

---

# Project Structure

repview
│
├ index.html
├ search.html
├ member.html
│
├ css
│ └ style.css
│
├ js
│ ├ app.js
│ ├ search.js
│ └ member.js
│
├ data
│ ├ members.json
│ ├ votes.json
│ └ countries.json
│
└ img
└ members

---

# Data Model

## Member

id
name
country
chamber
party
district
photo
stats

Stats example:

attendance
vote_participation
bills_proposed

---

## Votes

vote_id
title
date
result

---

# Global Expansion

RepView is designed to support multiple parliamentary systems.

Data hierarchy:

country
↓
parliament
↓
chamber
↓
member

Examples:

KR → National Assembly
US → House / Senate
UK → House of Commons
EU → European Parliament

---

# Data Sources (Future)

Future data may come from official parliamentary APIs.

Examples:

- South Korea National Assembly
- US Congress API
- UK Parliament API
- European Parliament datasets

The initial prototype uses **static JSON data**.

---

# Development Phases

## Phase 1 – UI Prototype

Focus on:

- landing page
- representative search
- representative page
- big number sections

---

## Phase 2 – Data Integration

Add:

- real representative data
- voting records
- bill data

---

## Phase 3 – Global Expansion

Add support for:

- United States
- United Kingdom
- European Union
- other democratic legislatures

---

# Positioning

Existing platforms such as Politrack or OpenWatch focus on **data aggregation**.

RepView focuses on **clarity and visual presentation**.

It is not a data-heavy research platform.

It is a **visual civic dashboard for ordinary citizens**.

---

# Product Goal

RepView should allow a user to instantly answer:

**“Is my representative actually doing their job?”**

This should be visible in seconds through:

- portraits
- big numbers
- clear summaries

The product should feel **clean, modern, and visually powerful**.
