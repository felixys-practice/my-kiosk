-- 같은 사건(event_key)·수신 범위·수신자 조합의 알림은 한 번만 만든다 (data-model §8)
-- 범위 알림은 수신자가 null이므로 NULLS NOT DISTINCT로 null끼리도 같은 값으로 본다(PostgreSQL 15 이상)
CREATE UNIQUE INDEX "refund_notifications_event_audience_recipient_key"
ON "refund_notifications" ("event_key", "audience", "recipient_user_id") NULLS NOT DISTINCT;
