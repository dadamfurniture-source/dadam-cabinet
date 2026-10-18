# CAD 프로토타입 (2026-10-19, 참고용)

오늘 사장님과 확인하며 만든 build123d 모델이다. **규칙의 정본이 아니다** — 숫자가 파이썬에 직접 들어 있고
(예: 걸레받이 들임 50, 상판 깊이 600), 플래너·BOM 과 기준선이 다른 값도 있다. 계획 PR8 에서
조립 명세 JSON 만 읽는 `tools/cad/build_from_spec.py` 로 대체하고 이 폴더는 지운다.

| 파일 | 내용 |
|---|---|
| `lower_cabinet_2d.py` | 하부장(2D) 900 한 통 — 목찬넬 따내기, 처짐방지목 앞선, 앞 밴드 목찬넬 아래, 뒷판 899×707 측판 뒤 |
| `sink_set.py` | 싱크대 I자 4100 세트 — 다리발, 상판, 걸레받이, 목찬넬 라인, 상부장(사쿠리 홈), 휠라, 상몰딩 |
| `export_plain.py` / `export_set.py` | build123d 로 STEP·GLB 를 `out/` 에 쓰고 판재 쌍별 겹침 부피를 잰다 |
| `check.py` | 하부장 STEP 을 다시 읽어 부재 치수·겹침 확인 |

실행 (리눅스·윈도 공통, uv 필요):

```bash
uv run --no-project --python 3.13 --with cadgen==0.7.22 python export_set.py
```

주의
- 소스는 ASCII 만 쓴다. cadgen 이 윈도에서 소스를 cp949 로 읽어 한글이 있으면 실패한다 — 한글 부재 이름은 `K(0xce21, ...)` 코드포인트로 만든다.
- 윈도에서는 cadgen 모델 러너(`python model.py` 의 데코레이터 실행)가 import 오류로 안 돈다. 그래서 `export_*.py` 가 build123d 내보내기를 직접 부른다.
- 결과 확인: 데스크톱 앱의 text-to-cad 플러그인 `cad_show` 로 `out/*.step` 을 CAD 뷰어(127.0.0.1)에서 연다 — 로컬 스레드에서만 된다.
