/**
 * 진행 중인 정지 기록의 조회 조건
 * - 재개되지 않았고(resumedAt null), 환불 확정으로 재개 없이 닫히지도 않은(closedAt null) 정지만 진행 중이다
 * - 활성 정지를 찾는 모든 조회가 이 조건을 함께 써서 닫힌 정지를 정지 중으로 보지 않게 한다
 */
export const activePauseWhere = { resumedAt: null, closedAt: null } as const;
