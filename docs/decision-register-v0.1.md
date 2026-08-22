# 공동 설계 결정 레지스터 v0.1

> 목적: Human·Claude Code·Codex의 제안, 결정, 리뷰 상태를 한 곳에서 추적한다.
> 최종 결정권자: `PM`

## 상태 정의

- `제안`: 담당자가 초안을 냈으나 승인되지 않음.
- `리뷰 대기`: 다른 에이전트의 독립 검토가 필요함.
- `PM 결정 대기`: 선택에 제품 판단이 필요함.
- `승인`: PM이 채택함.
- `반려`: 이유와 대안을 기록하고 닫음.

## 제품 전제

| ID | 결정 항목 | Codex 권장안 | Claude 의견 | 상태 | Human 결정 |
|---|---|---|---|---|---|
| H-001 | 핵심 타깃 | 일반 캐주얼 경영게임 유저 | 동의 | 승인 | 재미·몰입 우선 대상 |
| H-002 | 1회 플레이 시간 | 30~40분 | 동의 | 승인 | **30~40분 채택** |
| H-003 | 현실성:게임성 | 실측 정확도보다 재미·몰입 우선 | 동의 | 승인 | `team-plan.md` 기록 |
| H-004 | 기업·브랜드 | 기업 실명 유지, 공식 로고 보류 | 미제안 | 승인 | **가상 브랜드명으로 전면 교체** — 두 에이전트 권고(실명 유지)와 다른 방향. 상세·후속작업은 `docs/plan-synthesis.md` §6 |
| H-005 | 우선 플랫폼 | 외부 의존성 없는 단일 HTML 웹 | 동의 | 승인 | 기존 원칙 유지 |

## 시스템·검증 결정

| ID | 결정 항목 | Codex 권장안 | Claude 의견 | 상태 | Human 결정 |
|---|---|---|---|---|---|
| D-001 | 시장 엔진 진실 원천 | 제한된 Supply/Demand + 정권 prior 하이브리드 | 방향 동의·fixture 뒤 A/B | **의도적 유예** | S6(고정 시드 fixture로 현 엔진 vs 하이브리드 A/B) 이후 재상정 — 두 에이전트 합의, PM 확인 |
| D-002 | Ramp Valley 의미 | 전환 완료 뒤 정확히 2개 정산 분기 | 동의(P0-A로 재현·확인) | 승인 | Claude+Codex 합의, S1에서 구현 |
| D-003 | 분기당 3개 결정 | 코어와 검증 전략에도 동일하게 강제 | 동의(P0-B로 재현·확인) | 승인 | Claude+Codex 합의, S1에서 구현 |
| D-004 | 지배전략 판정 | 중앙값·하위25%·파산율·상위10% 함께 사용 | 동의 | 승인 | Claude+Codex 합의, S3에서 `validate.js`에 반영 |
| D-005 | 시대별 파산율 | AI 5~15%, 둔화 20~35%, 성숙 40~60% | 정밀화 후순위 | **의도적 유예** | 두 에이전트 모두 "S2 기준선 이후" 의견 일치, PM 확인 |
| D-006 | HBM 전환·퀄 | 미진입→투자→퀄→승인→램프 상태기계 | 동의(P0-C로 재현·확인) | 승인 | Claude+Codex 합의, S1에서 구현 |
| D-007 | 공급압력 부호 | 공급 초과가 가격을 낮추도록 `capacityPressure` 차감 | 확인·동의 | 승인 | Claude S0 구현 완료(`79ccf4f`), Codex 독립 검증 |

상세 근거는 `docs/design-audit-v0.2-v0.4.md`에 있다.

## 구조·협업 결정

| ID | 결정 항목 | 제안 | 상태 | Human 결정 |
|---|---|---|---|---|
| A-001 | 개발 구조 | 현재 `src/` 분리 + `build.js` + 단일 `index.html` 유지 | 동의 | PM 승인 | `bf103ce` 구현 완료 |
| A-002 | 에셋 범위 | P0는 canvas/inline SVG/CSS 우선, 외부 바이너리는 후순위 | 동의 | PM 승인 | manifest로 교체 경로 유지 |
| R-001 | 고정 담당 이름 | PM / Claude / Codex | 동의 | PM 승인 | `team-plan.md` 기록 |
| R-002 | 협업 방식 | 같은 문제를 별도 브랜치에서 병행 프로토타입 | 동의 | PM 승인 | 채택은 PM |
| P-001 | 첫 병행 프로토타입 | 분기 결과 인과 카드 UI | 승인 | PM 승인 | Claude/Codex 독립 구현 뒤 PM 비교 |
| W-001 | 작업이력 필드 | 담당·모델·리뷰어·입력·판단·검증·미결·산출물 필수 | 적용 중 |  |
| A-003 | P0 에셋 인벤토리 | `asset-spec-v0.1.md`의 11종 | 승인 | PM 승인 | 그대로 승인, 제작 착수는 A-004(브랜드) 이후 |
| A-004 | 진영 브랜드명 신규 제작 | 한 단어 이름 4종 + 3자 이하 코드 | Codex 수정안 완료 | PM 결정 대기 | `docs/brand-name-proposals-v0.1.md`, 승인 전 사용 금지 |

## 보드게임 BM 통합 결정

| ID | 결정 항목 | Codex 권장안 | Claude 의견 | 상태 | Human 결정 |
|---|---|---|---|---|---|
| BM-001 | Brass·Kanban EV·Silicon Valley·Acquire BM 반영 범위 | 기존 1인 게임의 표현·상태 레이어로 선택 통합. 전체 규칙 결합은 별도 2~4인 모드 후보로 분리 | 독립 리뷰 대기 | PM 결정 대기 | `docs/benchmark-integration-v0.1.md` 검토 필요 |
| BM-002 | 첫 BM 수직 슬라이스 | 5개 부서 Fab Operations Board + 프로젝트 타일 뒤집기 + 기존 인과 카드 연결 | 독립 리뷰 대기 | PM 결정 대기 | 코어·밸런스 변경 없이 A/B 프로토타입 제안 |

## 리뷰 실행 상태

| 작업 | 담당 | 상태 | 증거 |
|---|---|---|---|
| X-001~003 Codex 초안 | `Codex` | 완료 | 설계 감사·에셋 명세·플레이테스트 문서 |
| X-004 v0.5 통합 초안 | `Codex` | 완료 | `docs/design-v0.5-draft.md` |
| C-PLAN-001 Claude 독립안 | `Claude` | 완료 | `docs/plan-claude.md`, 커밋 `d46185b` |
| X-PLAN-002 Codex 독립안 | `Codex` | 완료 | `docs/plan-codex.md` |
| C-AUDIT-001 Codex 감사 검증 | `Claude` | 완료 | `origin/claude/dev` 커밋 `89c9585` |
| X-REVIEW-002 P0-E 독립 검증·D-001 답변 | `Codex` | 완료 | `docs/plan-codex-response.md` |
| X-TRACE-001 인과 추적 계약 | `Codex` | 초안 완료 | `docs/trace-schema-v0.1.md` |
| P-001-A Codex 인과 카드 시안 | `Codex` | 설계 완료 | `docs/causal-card-prototype-a.md` |
| X-SYNTH-001 정반합 초안 | `Claude+Codex` | 완료 | `docs/plan-synthesis.md` — P0 우선·인과 카드·에셋 정책·D-001 순서 합의 |
| S0 P0-E 부호 수정 | `Claude` | 완료 | 커밋 `79ccf4f`, Codex 독립 검증(`plan-codex-response.md`) |
| 개별 항목 결정 | `PM` | 완료 | H-002=30~40분, H-004=가상 브랜드 전면 교체, P0 에셋 목록 승인 (개별 항목만 — 문서 전체 승인 아님) |
| X-005 v0.5 최종 승격(초안) | `Claude` | **PM 검토 대기** | `docs/design-v0.5.md` — Claude가 개별 결정을 근거로 승격했으나 문서 전체를 PM이 확인한 적 없음. 확인 전 S1 이후 보류 |
| A-004 가상 브랜드명 초안 | `Codex` | PM 검토 대기 | `docs/brand-name-proposals-v0.1.md` |

## 승인 방법

PM은 각 행의 `Human 결정`에 `승인`, 수정값 또는 반려 사유를 기록한다. 채팅에서 결정한 경우
그 결정을 받은 에이전트가 이 파일과 `docs/worklog.md`에 같은 작업 ID로 옮겨 적고, 다른 에이전트가
다음 확인 시점에 diff를 검토한다(이번 라운드는 `Claude`가 PM과 직접 대화하며 기록, `Codex`는
다음 동기화 때 검토).
