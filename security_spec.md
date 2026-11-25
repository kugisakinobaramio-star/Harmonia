# MusicKK Firestore Security Specification

## 1. Data Invariants
1. Every document under `/users/{userId}` and its subcollections (`playlists`, `playlists/{playlistId}/entries`, `likedSongs`, `recentHistory`, `playedTracks`, `tasteStats`, `followedArtists`) is strictly owned by `request.auth.uid == userId`.
2. Global default-deny catches all unmatched paths (`/{document=**}`).
3. Document IDs in paths (`userId`, `playlistId`, `entryId`, `trackDocId`, `statId`, `artistDocId`) must match `^[a-zA-Z0-9_-]+$` and be `1..128` characters.
4. No user document or subcollection document may contain unvalidated shadow/ghost fields (`keys().hasOnly(...)`).
5. No track snapshot in Firestore may contain temporary stream URLs or credentials (`streamUrls`, `previewUrl`, `youtubeId`, `youtubeAlternates`, `alternates`, `lyrics`).
6. Every subcollection document must bind `uid == userId`, and `allow list` queries must verify `resource.data.uid == request.auth.uid`.
7. `createdAt` and `updatedAt` timestamps must match `request.time` on creation, and `createdAt`/`uid` are immutable on update.
8. Every string and list has explicit maximum length bounds to prevent resource exhaustion.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Cross-User Read/Write**: User `uid_attacker` reads or writes `/users/uid_victim` or `/users/uid_victim/likedSongs/x`.
2. **Unauthenticated Access**: `auth == null` reads or writes any path under `/users/...`.
3. **UID Spoofing on Create**: User `uid_a` creates `/users/uid_a/playlists/pl1` with `uid: "uid_victim"`.
4. **Shadow / Ghost Field Injection**: User `uid_a` writes `/users/uid_a` with `{ ..., isAdmin: true, role: "superadmin" }`.
5. **Temporary Stream URL Leakage**: User `uid_a` writes `/users/uid_a/likedSongs/t1` with `track.streamUrls` or `track.previewUrl`.
6. **Path ID Poisoning**: User `uid_a` writes `/users/uid_a/playlists/` with a 200-char or invalid-char ID (`pl$bad!`).
7. **Timestamp Spoofing**: User `uid_a` creates `/users/uid_a` with client-forged `createdAt` instead of `request.time`.
8. **Immutable Field Mutation**: User `uid_a` updates `/users/uid_a` trying to change `uid` or `createdAt`.
9. **Oversized String / List Exhaustion**: User `uid_a` writes `displayName` > 100 chars or `favoriteArtists` > 50 items.
10. **Invalid Region / Quality Enum**: User `uid_a` writes `region: "MARS"` or `quality: "999kbps"`.
11. **Unbounded List Query Without Owner Filter**: User `uid_a` attempts `list` on `/users` or `/users/uid_victim/playlists`.
12. **Orphaned Subcollection Write**: User `uid_a` writes `/users/uid_a/playlists/pl1/entries/e1` when parent `/users/uid_a/playlists/pl1` does not exist.
