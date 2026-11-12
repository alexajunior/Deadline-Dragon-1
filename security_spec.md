# Deadline Dragon — Firestore Security Specification

## 1. Data Invariants
1. **Owner-Isolated Progression (`/users/{userId}`)**: A player progression document can only be read (`get`), created, or updated by the verified authenticated user whose `request.auth.uid == userId` and `incoming().uid == request.auth.uid`. Blanket `list` queries on `/users` are denied. Zero PII (no emails, phones, or addresses) is stored in `/users/{userId}`.
2. **Immutable Wardrobe & Score Bounds**: `bestCredits` is strictly an integer between `0` and `100000000`. `unlockedItems` is strictly bounded to `<= 30` items. `createdAt` is immutable after creation and validated with `request.time`.
3. **Immutable Global Leaderboard (`/leaderboard/{entryId}`)**: Leaderboard records can only be created by verified authenticated users (`request.auth.token.email_verified == true`) with `incoming().uid == request.auth.uid`, valid subject enum, integer bounds (`credits` 0..100000000, `tasksSolved` 0..10000), and `createdAt == request.time`. Updates are completely forbidden; only the author can delete their own entry.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated User Write**: `create /users/userA` with `auth = null`.
2. **Identity Spoofing on Profile**: `create /users/userA` as `auth.uid = userB`.
3. **UID Field Poisoning**: `create /users/userA` as `auth.uid = userA` with `uid: "userB"`.
4. **Shadow Ghost Field Injection**: `create /users/userA` adding `isAdmin: true`.
5. **Client Timestamp Forgery**: `create /users/userA` with a past timestamp instead of `request.time`.
6. **Immutable `createdAt` Tampering**: `update /users/userA` changing `createdAt`.
7. **Unverified Email Write**: `create /leaderboard/e1` with `email_verified: false`.
8. **ID Poisoning (Oversized / Invalid Characters)**: `create /leaderboard/!@#$...` (> 128 chars or invalid regex).
9. **Array Bloat DoS**: `update /users/userA` with `unlockedItems` containing 50+ items.
10. **Leaderboard Score Manipulation**: `update /leaderboard/e1` attempting to raise `credits`.
11. **Leaderboard Impersonation**: `create /leaderboard/e1` as `userA` with `uid: "userB"`.
12. **Blanket User List Scrape**: `list /users` as `userA`.
