# Community Discovery & Recommendation Features

This document summarizes the completed work on robust, scalable, and user-friendly community discovery and recommendation features for the Xplore-Pulse backend (Node.js, Sequelize, GraphQL).

---

## 1. Validation and Update Logic
- Improved validation for community updates:
  - Handles transitions between paid/free communities.
  - Ensures price and currency are required for paid, nulled for free.
  - Edge cases handled in the service layer.

## 2. Community Feed/Discovery Algorithm
- Multi-tiered algorithm for community discovery:
  1. **Tier 1:** Communities matching user’s onboarding interests.
  2. **Tier 2:** Communities matching filter interests (if provided).
  3. **Tier 3:** Popular/trending communities.
  4. **Tier 4:** Other communities.
- Excludes already joined/owned communities.
- Supports infinite scroll with cursor-based pagination.

## 3. Scoring and Sorting
- Fine-tuned scoring system for relevance:
  - Interest overlap, popularity, recency, activity, free/paid status.
- Advanced trending logic:
  - Weekly growth, recent posts, reactions, last post recency.
- Cron job (node-cron) updates community stats for trending logic every hour.

## 4. GraphQL Schema and API
- Schema updates:
  - `recommendedCommunities` query for a pure, filterless “For You” feed (filters: `isPaid`, `trending`).
  - `discoverCommunities` query supports all relevant filters and sort options.
  - Added `TRENDING` to `CommunitySortBy` enum.
- Backend supports all enum values:
  - `CREATED_AT`, `MEMBER_COUNT`, `ACTIVITY`, `RELEVANCE`, `TRENDING`.

## 5. Backend Implementation
- Explicit handling of all sort options:
  - **CREATED_AT:** Sort by newest.
  - **MEMBER_COUNT:** Sort by most members.
  - **ACTIVITY:** Sort by most recently active.
  - **RELEVANCE:** Custom scoring.
  - **TRENDING:** Advanced trending score.
- Enum names are standard and do not require changes.

## 6. Best Practices and UX
- Both “Recommended for You” and “Discover/Explore” feeds are supported.
- Multiple sort options enhance user engagement.
- Backend supports frontend infinite scroll and filtering.

## 7. Other Enhancements
- Added composite indexes to models for performance.
- Excludes owned communities from joined lists.
- Allows exclusion of the current user from community member queries.

---

## Final State
- Backend is robust, scalable, and supports all major discovery, recommendation, and sorting features expected in a modern social/community app.
- API and schema are aligned with industry standards.
- Ready for frontend integration and further enhancements. 