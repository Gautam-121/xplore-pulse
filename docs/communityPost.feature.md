# Community Post System Feature Overview

This document summarizes the design and implementation of the production-grade, scalable community post system, inspired by leading social platforms (Instagram, Facebook, LinkedIn).

---

## 1. **Feature Requirements**
- **Role-based Posting:** Only community OWNER, ADMIN, or MODERATOR can create posts. Posts are visible to community members.
- **Post Types:** Supports video, image, text, link, poll (with voting), educational, and mixed (carousel) posts.
- **Polls & Quizzes:** Posts can include polls (with options and voting) and quizzes (with multiple questions and answers).
- **Mentions, Reactions, Bookmarks:** Users can mention others, react (like, love, etc.), and bookmark posts.
- **Visibility & Sponsorship:** Posts can have different visibility levels and sponsorship status.

---

## 2. **Model & Database Design**
- **CommunityPost:** Central table for all post data, with fields for type, content, media (JSONB array for mixed media), poll options, quizzes, tags, mentions, and more.
- **Polls & Quizzes:**
  - `pollOptions` and `quizzes` fields in CommunityPost for options/questions.
  - **PollVotes** and **QuizResponses** moved to separate tables for scalability.
- **Mentions, Reactions, Bookmarks:**
  - Separate, indexed tables: `PostMention`, `PostReaction`, `PostBookmark`, `QuizResponse`, `PollAnswer`.
  - All use UUIDs and proper indexing for high-scale analytics and queries.
- **Atomic Transactions:** All DB writes are atomic to ensure data integrity.

---

## 3. **GraphQL Schema**
- **Types & Enums:**
  - `CommunityPost`, `PollOption`, `Quiz`, `Media`, `PostMention`, `PostReaction`, `PostBookmark`, etc.
  - Enums for `PostType`, `MediaType`, `ReactionType`, `PostVisibility`.
- **Mutations & Queries:**
  - Create post, react/unreact, bookmark/unbookmark, vote on poll, answer quiz, get poll/quiz results, get mentions.
- **Modular Schema:**
  - All post-related types, queries, and mutations are in `communityPost.graphql`, merged via `index.js` using `@graphql-tools`.

---

## 4. **Service & Resolver Logic**
- **communityPostService:** Handles post creation, validation, atomic transactions, and error handling.
- **postReactionService:** Manages reactions, prevents duplicates, aggregates counts.
- **postBookmarkService:** Handles bookmarking, prevents duplicates.
- **postMentionService:** Manages mentions, validates users.
- **pollAnswerService:** Handles poll voting, prevents duplicate votes, aggregates results.
- **quizResponseService:** Handles quiz answers, prevents duplicate answers, aggregates results.
- **Resolvers:** All mutations/queries call the appropriate service, use authentication, and propagate errors.

---

## 5. **Validation & Edge Cases**
- **Strict Input Validation:**
  - Enums, title/content length, media structure, URL format, tags, quiz/poll options, mentions, visibility, sponsorship.
- **Duplicate Prevention:**
  - Unique indexes and upserts for reactions, bookmarks, votes, answers.
- **Membership Checks:**
  - Only community members can interact with posts.
- **Clear Error Messages:**
  - All errors are specific and user-friendly.

---

## 6. **Best Practices & Scalability**
- **Separation of Concerns:**
  - Core post data in one table; high-volume user actions in separate tables.
- **Efficient Indexing:**
  - All high-scale features are indexed for fast queries.
- **Modular Codebase:**
  - Schema and services are modular and maintainable.
- **Extensibility:**
  - Designed for future features (comments, shares, notifications, analytics).
- **Production-Grade:**
  - Consistent with industry leaders, robust validation, atomic transactions, and scalable design.

---

## 7. **Next Steps & Extensibility**
- Example queries/mutations and frontend integration can be added.
- Advanced analytics, notifications, and comment/sharing features are easy to extend.

---

**In summary:**
This backend is ready for real-world deployment, supporting all modern social features with robust validation, scalability, and best practices. 