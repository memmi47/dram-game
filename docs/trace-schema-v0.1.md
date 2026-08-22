# 분기 인과 추적 데이터 계약 v0.1

> 작업 ID: `X-TRACE-001`
> 계약 설계: `Codex`
> 코어 훅 구현 예정: `Claude`
> 소비자: Claude/Codex 인과 카드 시안, 로컬 플레이테스트 로그
> 상태: 구현 전 리뷰 초안

## 1. 목적과 경계

`src/trace.js`는 한 분기의 **결정 → 지연 프로젝트 → 시장·경쟁 반응 → 정산 결과**를 연결하는
JSON 직렬화 가능 데이터만 만든다. 사용자용 문장은 넣지 않고 UI가 `messageKey`와 원본 수치로 표현한다.

- 같은 시드·같은 결정이면 같은 trace가 나와야 한다.
- trace는 정산 사실을 기록하며 시뮬레이션 상태나 결과를 변경하지 않는다.
- 숫자로 분해할 수 없는 원인에 임의의 기여율을 붙이지 않는다.
- 미래 예상과 이미 정산된 결과를 섞지 않는다.
- 현재 시장의 `sufficiency`는 실제 Supply/Demand가 아니므로 `implied_from_price`라고 명시한다.

## 2. 분기 단위 최상위 구조

```text
QuarterTrace
  schemaVersion          "trace-v0.1"
  turn                   정산된 분기 번호
  era                    정산 시점 시대
  decisions[]            이번 분기에 제출·적용·거부된 결정
  projects[]             과거 결정에서 시작된 장기 프로젝트 상태 변화
  market                 가격·공급압력의 계산 분해
  competitors[]          이번 분기에 관측 가능한 경쟁사 행동
  outcomes[]             현금·영업이익·ASP 등 결과와 원인 연결
```

한 게임 전체 로그는 `QuarterTrace[]`를 턴 순서대로 보관한다. 실행 ID와 시드는 코어 밖의 세션 메타데이터에
기록하고, 카드가 이를 필요로 하지 않게 한다.

## 3. 공통 형식

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | string | 한 실행 안에서 유일하고 생성 뒤 불변 |
| `turn` | integer | 1부터 시작하는 정산 분기 |
| `actorId` | string | `SKH`, `SEC`, `MU`, `CXMT`, `MARKET`, `SYSTEM` |
| `value` | number/string/boolean | 표시 문자열 대신 원본값 |
| `unit` | enum | `KRW_SIM`, `INDEX_POINT`, `LOG_RETURN`, `PERCENT`, `WAFER`, `BIT`, `QUARTER`, `LEVEL` |
| `messageKey` | string | 선택 필드. 사용자 문장 대신 로케일 키만 저장 |

금액 단위 `KRW_SIM`은 현재 게임 내부 단위다. 실제 원화처럼 표기하려면 별도 환산 규칙을 먼저 승인한다.

## 4. 결정 계약 `DecisionTrace`

| 필드 | 필수 | 내용 |
|---|---|---|
| `id` | 예 | `decision:{actorId}:{submittedTurn}:{ordinal}` |
| `actorId` | 예 | 결정을 내린 회사 |
| `decisionType` | 예 | 아래 결정 enum |
| `submittedTurn` | 예 | 플레이어·AI가 결정을 제출한 턴 |
| `effectiveTurn` | 예 | 비용·레벨 변경이 처음 반영된 턴 |
| `expectedCompletionTurn` | 조건부 | 증설·노드 전환 등 장기 프로젝트. 즉시 결정은 `null` |
| `actualCompletionTurn` | 조건부 | 완료 전 `null`, 완료 뒤 실제 턴 |
| `status` | 예 | `applied`, `queued`, `in_progress`, `completed`, `rejected`, `cancelled` |
| `before`, `after` | 예 | `{ value, unit }`. 불리언 결정도 명시 |
| `projectId` | 조건부 | 장기 프로젝트와 연결. 즉시 결정은 `null` |
| `rejectionReason` | 조건부 | 결정 예산 초과 등 코어가 거부한 이유 enum |

결정 enum:

```text
utilization | hbm_allocation | yield_investment | cash_stance |
capacity_expansion | node_transition
```

같은 레버 값을 다시 제출해 변화가 없으면 새 `DecisionTrace`를 만들지 않는다. 분기당 3개 결정 제한에서
거부된 입력은 상태를 바꾸지 않지만 `status=rejected`로 기록해 UI와 검증기가 같은 사실을 보게 한다.

## 5. 장기 프로젝트 계약 `ProjectTrace`

| 필드 | 필수 | 내용 |
|---|---|---|
| `id` | 예 | 생성한 `DecisionTrace.projectId`와 동일 |
| `originDecisionId` | 예 | 프로젝트를 시작한 결정 ID |
| `projectType` | 예 | `capacity_expansion`, `node_transition`, `hbm_qualification` |
| `actorId` | 예 | 프로젝트 소유 회사 |
| `startedTurn` | 예 | 시작 턴 |
| `expectedCompletionTurn` | 예 | 시작 시 계산한 완료 예정 턴 |
| `actualCompletionTurn` | 조건부 | 완료 전 `null` |
| `remainingQuartersBefore`, `remainingQuartersAfter` | 예 | 이번 정산 전후 잔여 분기 |
| `status` | 예 | `started`, `progressed`, `completed`, `blocked`, `cancelled` |
| `effects[]` | 조건부 | 완료 시 바뀐 node·capacity·yield 등 `{ metric, before, after, unit }` |

HBM 퀄은 플레이어 결정 자체가 아니라 배분·노드 조건에서 파생될 수 있다. 이 경우 `originDecisionId`는
원인이 된 최근 HBM 배분 결정이고, 원인 결정이 없으면 `null`과 `SYSTEM` 출처를 함께 기록한다.

## 6. 시장 계약 `MarketTrace`

```text
priceBefore                 INDEX_POINT
priceAfter                  INDEX_POINT
priceLogDelta               LOG_RETURN
regimeReturnLog             LOG_RETURN
noiseLog                    LOG_RETURN
supplyPressureRaw           PERCENT = actualSupplyGrowth - trendSupplyGrowth
supplyPressureLog           LOG_RETURN = 가격식에 실제 적용된 부호까지 반영한 값
actualSupply                BIT
actualSupplyGrowth          PERCENT
trendSupplyGrowth           PERCENT
balanceSignal.kind          implied_from_price | supply_demand
balanceSignal.value         현재 버전에서는 implied Sufficiency
phaseBefore, phaseAfter     국면 enum
```

필수 불변식:

```text
priceLogDelta = clamp(regimeReturnLog + noiseLog + supplyPressureLog, -0.28, 0.28)
```

P0-E 수정 뒤 `supplyPressureRaw > 0`이면 `supplyPressureLog <= 0`이어야 한다. D-001 채택 전에는
`balanceSignal.kind=implied_from_price`만 허용하며, 카드 문구에서 “수요 대비 실제 공급”이라고 부르지 않는다.

## 7. 경쟁사 계약 `CompetitorTrace`

| 필드 | 필수 | 내용 |
|---|---|---|
| `id` | 예 | `competitor:{actorId}:{turn}:{ordinal}` |
| `actorId` | 예 | 경쟁사 ID |
| `turn` | 예 | 행동이 실제 반영된 턴 |
| `actionType` | 예 | 결정 enum과 동일하거나 `bankruptcy` |
| `before`, `after` | 예 | 관측 가능한 상태 변화 |
| `visibility` | 예 | `public`, `signal_only`, `hidden` |
| `linkedDecisionId` | 조건부 | AI 결정 trace가 있으면 연결 |
| `marketLinkId` | 조건부 | 시장 공급압력과 연결할 때 사용 |

카드는 `hidden` 항목을 현재 턴에 공개하지 않는다. 회고 화면에서는 PM이 승인한 범위에서만 노출한다.

## 8. 결과와 원인 귀속 계약

`OutcomeTrace`:

| 필드 | 필수 | 내용 |
|---|---|---|
| `id` | 예 | `outcome:{actorId}:{turn}:{metric}` |
| `actorId`, `turn` | 예 | 결과 주체와 정산 턴 |
| `metric` | 예 | `cash`, `net_cash_flow`, `revenue`, `operating_income`, `price`, `saleable_bit`, `hbm_revenue` |
| `before`, `after`, `delta`, `unit` | 예 | 결과 수치 |
| `attributions[]` | 예 | 아래 `AttributionTrace` 목록 |

`AttributionTrace`:

| 필드 | 필수 | 내용 |
|---|---|---|
| `sourceType` | 예 | `decision`, `market`, `competitor`, `system` |
| `sourceId` | 예 | 연결된 결정·시장·경쟁사·시스템 항목 ID |
| `relationship` | 예 | `direct`, `lagged`, `counterfactual`, `context` |
| `direction` | 예 | `up`, `down`, `neutral` |
| `lagQuarters` | 예 | 원인 발생 턴과 결과 턴 차이 |
| `contribution` | 조건부 | `{ value, unit }`. 정확히 분해 가능한 경우에만 사용 |
| `evidence` | 예 | `exact`, `modeled`, `context_only` |

원인 범주에 `system`을 추가한 이유는 정권 prior, 노이즈, 유지보수비처럼 결정·시장·경쟁사에 억지로
귀속하면 안 되는 잔차가 있기 때문이다.

### 숫자 귀속 규칙

- 현금의 `영업이익 - capex - 이자`와 가격의 로그수익률 항처럼 산식이 가산형이면 `exact`를 사용한다.
- “증설하지 않았다면 가격이 얼마였을까”처럼 반사실 계산이 필요하면 fixture가 생기기 전까지
  `modeled`와 방향만 기록한다.
- 경쟁사 증설이 같은 분기 공급압력과 함께 관측됐지만 개별 가격 기여를 분리하지 못하면 `context_only`다.
- `contribution` 합이 결과 `delta`와 맞지 않으면 UI에서 백분율 원인 그래프를 만들지 않는다.

## 9. 카드 구현 전 계약 테스트

1. 같은 시드·결정 로그의 `QuarterTrace[]`가 바이트 단위로 동일하다.
2. 3개 초과 결정은 거부 trace를 남기고 상태를 바꾸지 않는다.
3. 증설·노드 전환의 `originDecisionId`가 완료 턴까지 유지된다.
4. P0-E 수정 뒤 공급증가 초과 시 `supplyPressureLog <= 0`이다.
5. 모든 `sourceId`는 같은 실행의 trace 항목을 가리킨다.
6. `exact` 기여값은 해당 가산형 결과식과 허용 오차 안에서 일치한다.
7. `implied_from_price` 신호가 실제 Supply/Demand로 직렬화되지 않는다.

## 10. 버전 규칙

- 필드 추가는 `trace-v0.1` 안에서 선택 필드로만 허용한다.
- enum 의미 변경, 필수 필드 삭제, 인과 산식 변경은 버전을 올린다.
- Claude 시안 B와 Codex 시안 A는 동일한 fixture의 동일한 `trace-v0.1`만 입력으로 사용한다.
