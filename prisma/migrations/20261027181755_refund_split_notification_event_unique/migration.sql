-- 알림 중복 방지 인덱스를 부분 인덱스 두 개로 나눈다(같은 의미, Prisma가 스키마 밖 일반 인덱스를 지우지 않도록)
-- 수신자가 있는 알림: (event_key, audience, recipient_user_id) 고유
-- 수신자가 없는 범위 알림: (event_key, audience) 고유
DROP INDEX "refund_notifications_event_audience_recipient_key";
CREATE UNIQUE INDEX "refund_notifications_event_audience_recipient_key"
ON "refund_notifications" ("event_key", "audience", "recipient_user_id")
WHERE "recipient_user_id" IS NOT NULL;
CREATE UNIQUE INDEX "refund_notifications_event_audience_no_recipient_key"
ON "refund_notifications" ("event_key", "audience")
WHERE "recipient_user_id" IS NULL;
