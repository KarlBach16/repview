좋다. 아래는 **ARCHITECTURE.md**다.
이 문서는 개발 구조 / 데이터 구조 / 확장 전략을 정의하는 문서다.
다른 AI 모델이나 개발자가 프로젝트를 이해하고 바로 작업할 수 있도록 작성했다.

⸻

ARCHITECTURE.md

# RepView – Architecture Specification

## Purpose

This document defines the system architecture of RepView.

RepView is designed as a **visual-first civic data platform** that allows users to search for political representatives and clearly understand their parliamentary activity.

The architecture prioritizes:

- simplicity
- visual performance
- global expandability
- rapid iteration

---

# System Architecture

RepView is initially implemented as a **static web application**.

Architecture model:

Frontend (Static Site)
↓
JSON Data Layer
↓
Future API/Data Ingestion

The frontend consumes JSON data and renders the interface dynamically using JavaScript.

---

# Technology Stack

Initial stack:

HTML
CSS
Vanilla JavaScript
JSON

No frameworks are used in the early stage.

Reasons:

- faster prototyping
- simpler debugging
- minimal build pipeline
- easier AI-assisted development

Future stack may include:

Node.js
Serverless API
Edge functions

---

# Application Layers

RepView is divided into three logical layers.

UI Layer
Application Logic Layer
Data Layer

---

# UI Layer

The UI layer handles rendering and layout.

Main pages:

index.html
search.html
member.html

Responsibilities:

- layout rendering
- scroll animations
- responsive design
- visual presentation

The UI follows **Apple-style visual storytelling**.

---

# Application Logic Layer

Located in:

/js

Files:

app.js
search.js
member.js

Responsibilities:

data loading
search logic
navigation
component rendering

---

## app.js

Core initialization logic.

Responsibilities:

load JSON data
global helpers
navigation initialization
fade-in animations

---

## search.js

Handles search functionality.

Responsibilities:

query parsing
fuzzy search
search results rendering
navigation to member page

---

## member.js

Responsible for rendering the representative page.

Responsibilities:

load member data
render hero section
render statistics
render recent votes
scroll section effects

---

# Data Layer

All data is stored in JSON files.

Location:

/data

Files:

members.json
votes.json
countries.json

The frontend loads this data dynamically.

Example loading:

fetch(“data/members.json”)

---

# Data Models

## Member Model

id
name
country
chamber
party
district
photo
stats

Stats structure:

attendance
vote_participation
bills_proposed

Example:

{
“id”: “kr_001”,
“name”: “Hong Gil-dong”,
“country”: “KR”,
“chamber”: “National Assembly”,
“party”: “Example Party”,
“district”: “Seoul Gangnam-gap”,
“photo”: “img/members/kr_001.jpg”,
“stats”: {
“attendance”: 92,
“vote_participation”: 88,
“bills_proposed”: 3
}
}

---

## Vote Model

vote_id
title
date
result

Example:

{
“vote_id”: “v001”,
“title”: “Pension Reform Bill”,
“date”: “2025-10-11”,
“result”: “passed”
}

---

## Country Model

id
name
parliament
flag

Example:

{
“id”: “KR”,
“name”: “South Korea”,
“parliament”: “National Assembly”,
“flag”: “🇰🇷”
}

---

# Routing Strategy

RepView uses **simple URL query routing**.

Examples:

member.html?id=kr_001
search.html?q=gangnam

This avoids the need for a full router framework.

---

# Image Architecture

Images are stored locally.

/img/members

Naming convention:

country_memberID.jpg

Example:

kr_001.jpg
us_102.jpg
uk_033.jpg

Recommended image ratio:

4:5

Portrait orientation ensures consistent visual design.

---

# Search Architecture

Search is implemented entirely in the frontend.

Search index source:

members.json

Search fields:

name
district
country

Recommended search approach:

fuzzy search

Libraries that may be used later:

Fuse.js

---

# Scroll Architecture

Member pages are built using **section-based scrolling**.

Each section occupies roughly:

100vh

Sections:

hero
attendance
vote participation
bills proposed
recent votes

Animations are triggered on scroll.

---

# Responsive Architecture

RepView follows a **mobile-first approach**.

Layout behavior:

Desktop:

image left
text right

Mobile:

image top
text below

Grid changes:

3 columns → desktop
2 columns → tablet
1 column → mobile

---

# Data Ingestion (Future)

Future versions will integrate real parliamentary data.

Pipeline architecture:

Parliament APIs
↓
Data ingestion scripts
↓
Normalized JSON
↓
Frontend

Possible tools:

Node.js
Python ETL scripts
cron jobs

---

# Global Parliament Model

RepView supports multiple legislative systems.

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

This structure allows easy expansion.

---

# Performance Strategy

Key goals:

fast load
minimal JS
static assets

Approach:

static hosting
CDN delivery
lazy image loading

---

# Deployment Strategy

Initial deployment can use:

GitHub Pages
Vercel
Netlify

No backend required for MVP.

---

# Security Considerations

Since the site is mostly static:

- minimal attack surface
- no authentication required
- no user data storage

Future versions may require:

rate limiting
API keys

for external data ingestion.

---

# Future Architecture

Later stages may introduce:

API layer
database
serverless functions

Example future stack:

Node.js
PostgreSQL
Edge APIs

However, the MVP intentionally avoids backend complexity.

---

# Architecture Philosophy

RepView follows a simple rule:

UI first
Data second
Infrastructure last

The goal is rapid experimentation and strong visual clarity.
