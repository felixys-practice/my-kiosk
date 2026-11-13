# 스키마 다이어그램 상태

`schema.dbml`과 `schema.dbdiagram`은 과거에 생성한 스키마 자료이며 현재 Prisma 스키마와 일치한다고 보장하지 않는다. 특히 `schema.dbdiagram`에 남은 `refund_locks`는 2026-10-30 제거된 테이블이다. 현재 모델은 `../schema.prisma`를 기준으로 확인한다. 구형 테이블의 생성·삭제 마이그레이션은 순차 적용을 위해 보존한다.
