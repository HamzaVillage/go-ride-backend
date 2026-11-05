# Ride chat rollout

Apply `db/migrations/add_ride_chat.sql` once before enabling chat. It creates:

- `ride_chat_messages`: temporary active-ride message storage, not an archive.
- `reported_Chat`: retained reported conversations and review metadata.

Set the backend environment and restart the backend:

```dotenv
RIDE_CHAT_ENABLED=true
```

The flag defaults to false, so old installed apps and databases that have not yet
received the migration keep their existing flows. The public config endpoint adds
`ride_chat_enabled`; reopen the updated apps to refresh it. Deploy updated customer
and driver builds to expose Chat during Accepted/Arrived/Started rides.

## Behavior and retention

Only the ride's authenticated customer and assigned driver may read, send or report.
JWT role alone is insufficient; shared tracking viewers do not get chat access.
Sending uses an idempotent client message ID, a one-second per-sender interval and
maximum 500 messages per ride, with 1000 characters per message. Socket events
provide realtime delivery; authenticated history loading recovers after reconnect.

Reports are allowed while chat is active. The report saves the existing transcript
and subsequent messages in that ride are appended to reported snapshots. Duplicate
reports by the same person reuse the existing report. The mobile UI explains that
reported conversations are retained, including later messages during that ride.

Completion/cancellation locks the ride, updates its status and deletes active chat
rows in the same MySQL transaction. Report rows are retained. Chat rooms close and
mobile history/drafts clear. A cleanup worker runs on startup and every minute for
orphaned messages or rides closed by older backend instances/manual database edits.
Deletion cleanup still works after disabling the feature. Drivers must be assigned
to the ride to complete it; unrelated accounts cannot erase its chat.

This permanently removes active messages from the application's live tables. SQL
backups, binary/general logs, device screenshots and infrastructure snapshots follow
their own retention policies. Configure those policies before promising physical or
cryptographic erasure from every copy. No chat text is persisted in mobile Redux or
AsyncStorage; notification routing stores only a ride ID. Push notifications contain
generic alerts, never message text.

## API and admin access

Authenticated participant routes:
- `GET /ride/:rideId/chat`
- `POST /ride/:rideId/chat/messages`: `{text, client_message_id}`
- `POST /ride/:rideId/chat/report`: `{reason}`

Authorized socket subscription: `ride_chat:subscribe` with `{ride_id}` and ack.
Events: `ride_chat:message`, `ride_chat:closed`. Dedicated `chat:<rideId>` rooms
prevent the legacy arbitrary ride-room join from exposing chat.

View reports directly in phpMyAdmin's `reported_Chat` table, or use:
- `GET /ride/chat/reports` (metadata, up to 50)
- `GET /ride/chat/reports/:reportId` (transcript)

These admin routes require an explicitly configured ADMIN_API_KEY or an admin JWT
signed with the configured JWT_SECRET. Legacy development fallback keys are rejected.
They remain available to configured admins if chat is later disabled.

## Notifications and checks

The existing Firebase Admin configuration, registered recipient FCM token and phone
notification permission are required for push delivery. Chat remains usable if push
fails. Generic alerts identify whether the driver/customer sent a message. Taps open
the protected chat screen; ended rides return CHAT_CLOSED and never return history.
Foreground alerts are suppressed only while the corresponding live chat is joined.

Run backend tests with `npm test`. Focused mobile checks:

```sh
npm test -- --watchman=false --runInBand __tests__/RideChat.test.tsx __tests__/ChatSocket.test.ts __tests__/MapMotion.test.tsx
```

Tests use transactional database doubles and mocked native/FCM services. Before
release, verify two real accounts on Android/iOS: accepted-only entry, two-way chat,
reconnect/background notification taps, report retention after ride end, removal of
unreported messages, and unrelated-user rejection. No production migration, real
FCM message, native build or real-device chat session is executed by these tests.
