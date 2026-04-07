      // ============================================================
      // 전역 변수 및 상수
      // ============================================================
      const CATEGORIES = [
        { id: 'sink', name: '싱크대', defaultD: 650, defaultH: 2310 },
        { id: 'island', name: '아일랜드', defaultD: 800, defaultH: 2310 },
        { id: 'wardrobe', name: '붙박이장', defaultD: 600, defaultH: 2310 },
        { id: 'fridge', name: '냉장고장', defaultD: 700, defaultH: 2310 },
        { id: 'shoerack', name: '신발장', defaultD: 350, defaultH: 2310 },
        { id: 'vanity', name: '화장대', defaultD: 500, defaultH: 2310 },
        { id: 'storage', name: '수납장', defaultD: 400, defaultH: 2310 },
        { id: 'warehouse', name: '창고장', defaultD: 450, defaultH: 2310 },
        { id: 'door', name: '도어교체', defaultD: 18, defaultH: 2310 },
        { id: 'custom', name: '비규격장', defaultD: 0, defaultH: 2310 },
      ];

      // ★ Rule 10: 균등분배 상수 (v28 업데이트)
      const DOOR_TARGET_WIDTH = 450; // 목표 도어 너비 (싱크대)
      const DOOR_MAX_WIDTH = 600; // 최대 도어 너비
      const DOOR_MIN_WIDTH = 350; // ★ 최소 도어 너비 (NEW)
      const MIN_REMAINDER = 5; // ★ 최소 잔여 (4→5, ACTIVE_RULES v28)
      const MAX_REMAINDER = 10; // 최대 잔여

      // ★ 개수대 기본 너비 (실측 기준)
      const SINK_DEFAULT_W_SMALL = 950; // W ≤ 2500mm
      const SINK_DEFAULT_W_LARGE = 1000; // W > 2500mm

      // ★ 개수대 최대 너비
      const SINK_MAX_W = 1100;

      // ★ 고정 너비 모듈 (갭 흡수 대상 제외)
      const LT_FIXED_W = 200;
      const COOK_FIXED_W = 600;

      const DEFAULT_SPECS = {
        layoutShape: 'I',
        doorColorUpper: '화이트',
        doorFinishUpper: '무광',
        doorColorLower: '화이트',
        doorFinishLower: '무광',
        topColor: '스노우',
        topThickness: 12,
        upperH: 720,
        lowerH: 870,
        moldingH: 60,
        sinkLegHeight: 150,
        handle: '찬넬 (목찬넬)',
        sink: '사각볼 850',
        faucet: '거위목 수전',
        hood: '히든 후드',
        cooktop: '인덕션',
        dishwasher: 'None',
        accessories: [{ id: Date.now(), type: 'LTMesh' }, { id: Date.now() + 1, type: 'Cutlery' }, { id: Date.now() + 2, type: 'Knife' }],
        // 실측 기준 = 분배기 기준 = 장 기준
        measurementBase: 'Left',
        distributorStart: null,
        distributorEnd: null,
        ventStart: null,
        secondaryUpperEnabled: true,
        finishLeftType: 'Filler',
        finishLeftWidth: 60,
        finishRightType: 'Filler',
        finishRightWidth: 60,
        finishCorner1Type: 'Filler',
        finishCorner1Width: 60,
        finishCorner2Type: 'Filler',
        finishCorner2Width: 60,
        topSizes: [{ w: '', d: '' }],
        effectiveUpperW: null,
        effectiveLowerW: null,
        // ★ 붙박이장 전용 설정
        curtainBoxW: 0,
        curtainBoxH: 0,
        wardrobePedestal: 60, // 좌대 높이 (기본 60mm)
        wardrobeMoldingH: 20, // 상몰딩 높이 (기본 20mm)
        // ★ 냉장고장 전용 설정 (규칙 기반)
        fridgeBrand: 'LG',
        fridgeUpperH: 415, // 상부장 높이 (고정)
        fridgeLowerH: 870, // 하부장 높이 (좌대 60 포함)
        fridgePedestal: 60, // 좌대 높이
        fridgeGap: 50, // 냉장고 좌우 여유 간격
        fridgeModuleD: 550, // 모듈 기본 깊이
        fridgeInstallD: 700, // 설치 필요 깊이
        // ★ 싱크대 필수장 체크 상태
        essentialLower: { sink: true, cook: true, lt: true },
        essentialUpper: { hood: true },
        upperDoorOverlap: 15, // 상부장 도어 오버랩 (기본 15mm)
        // ★ 상하부장 치수 모드: unified(통합) / split(분리)
        dimensionMode: 'unified',
        secondaryDimensionMode: 'unified', // Secondary Line 통합/분리
        // ── 하부장 구조 (layoutShape를 하부장용으로 유지)
        lowerLayoutShape: 'I',          // I / L / U
        lowerSecondaryW: '',
        lowerSecondaryH: '',
        lowerSecondaryD: '',
        lowerTertiaryW: '',
        lowerTertiaryH: '',
        lowerTertiaryD: '',
        // ── 상부장 구조 (분리 모드에서 독립)
        upperLayoutShape: 'I',          // I / L / U
        upperPrimeW: '',                // 분리 모드 상부장 가로
        upperPrimeD: '',                // 분리 모드 상부장 깊이
        upperSecondaryW: '',
        upperSecondaryH: '',
        upperSecondaryD: '',
      };

      // ★ 냉장고장 규칙 상수 (업데이트)
      const FRIDGE_RULES = {
        MAX_UPPER_H: 400, // 상부장 최대 높이
        PEDESTAL_H: 60, // 좌대 높이
        LEG_H: 60, // 다리발 높이
        LOWER_BODY_H: 810, // 하부장 모듈 높이 (다리 제외)
        MODULE_D: 550, // 모듈 기본 깊이
        INSTALL_D: 700, // 설치 필요 깊이
        TOP_GAP: 15, // 냉장고 상단 간격 (고정)
        MOLDING_H: 50, // 상몰딩 기본 높이
        EL_W: 600, // 키큰장/EL장 기본 폭
        HOMECAFE_W: 600, // 홈카페장 기본 폭
        // 여유공간 기본값
        DEFAULT_GAPS: {
          LG_BUILTIN: { side: 4, between: 8 },
          LG_FREESTANDING: { side: 50, between: 0 },
          SS_BESPOKE: { side: 12, between: 10 },
          SS_INFINITE: { side: 5, between: 10 },
          SS_FREESTANDING: { side: 50, between: 0 },
        },
      };

      // ★ 냉장고장 다리 타입
      const FRIDGE_LEG_TYPES = [
        { id: 'pedestal', name: '좌대', defaultH: 60 },
        { id: 'leg', name: '다리발', defaultH: 60 },
      ];

      // ★ 냉장고 모델 데이터 (여유공간 정보 포함)
      // ★ 냉장고 모델 데이터 (개별 도어 정보 포함)
      const FRIDGE_DATA = {
        LG: {
          name: 'LG',
          categories: {
            '단독 (Fit&Max)': [
              {
                id: 'lg_300l',
                name: '단독 300L',
                w: 595,
                h: 1780,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [{ name: '300L', w: 595 }],
              },
              {
                id: 'lg_400l',
                name: '단독 400L',
                w: 595,
                h: 1850,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [{ name: '400L', w: 595 }],
              },
              {
                id: 'lg_500l',
                name: '단독 500L',
                w: 700,
                h: 1850,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [{ name: '500L', w: 700 }],
              },
              {
                id: 'lg_600l',
                name: '단독 600L',
                w: 700,
                h: 1920,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [{ name: '600L', w: 700 }],
              },
            ],
            '세트 (Fit&Max)': [
              {
                id: 'lg_set_1d1d',
                name: '1도어+1도어',
                w: 1198,
                h: 1850,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'lg_set_1d1d1d',
                name: '1도어×3',
                w: 1809,
                h: 1850,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'lg_set_300_1d',
                name: '300+1도어',
                w: 1198,
                h: 1850,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '300L', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'lg_set_400_1d',
                name: '400+1도어',
                w: 1198,
                h: 1850,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '400L', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'lg_set_500_1d',
                name: '500+1도어',
                w: 1408,
                h: 1850,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '500L', w: 700 },
                  { name: '1도어', w: 700 },
                ],
              },
              {
                id: 'lg_set_500_300',
                name: '500+300',
                w: 1303,
                h: 1850,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '500L', w: 700 },
                  { name: '300L', w: 595 },
                ],
              },
              {
                id: 'lg_set_500_400',
                name: '500+400',
                w: 1303,
                h: 1850,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '500L', w: 700 },
                  { name: '400L', w: 595 },
                ],
              },
              {
                id: 'lg_set_600_300',
                name: '600+300',
                w: 1303,
                h: 1920,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '600L', w: 700 },
                  { name: '300L', w: 595 },
                ],
              },
              {
                id: 'lg_set_600_400',
                name: '600+400',
                w: 1303,
                h: 1920,
                d: 730,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '600L', w: 700 },
                  { name: '400L', w: 595 },
                ],
              },
            ],
            빌트인: [
              {
                id: 'lg_builtin_fridge_1d',
                name: '냉장고+1도어',
                w: 1568,
                h: 1860,
                d: 698,
                type: 'builtin',
                line: 'builtin',
                sideGap: 22,
                betweenGap: 11,
                units: [
                  { name: '냉장고', w: 897 },
                  { name: '1도어', w: 649 },
                ],
              },
              {
                id: 'lg_builtin_kimchi_1d',
                name: '김치+1도어',
                w: 1309,
                h: 1860,
                d: 698,
                type: 'builtin',
                line: 'builtin',
                sideGap: 22,
                betweenGap: 11,
                units: [
                  { name: '김치', w: 649 },
                  { name: '1도어', w: 649 },
                ],
              },
              {
                id: 'lg_builtin_fridge_kimchi',
                name: '냉장+김치',
                w: 1612,
                h: 1860,
                d: 698,
                type: 'builtin',
                line: 'builtin',
                sideGap: 22,
                betweenGap: 11,
                units: [
                  { name: '냉장', w: 897 },
                  { name: '김치', w: 649 },
                ],
              },
              {
                id: 'lg_builtin_fridge_kimchi_1d',
                name: '냉장+김치+1도어',
                w: 2272,
                h: 1860,
                d: 698,
                type: 'builtin',
                line: 'builtin',
                sideGap: 22,
                betweenGap: 11,
                units: [
                  { name: '냉장', w: 897 },
                  { name: '김치', w: 649 },
                  { name: '1도어', w: 649 },
                ],
              },
              {
                id: 'lg_builtin_1d3',
                name: '1도어×3',
                w: 2013,
                h: 1860,
                d: 698,
                type: 'builtin',
                line: 'builtin',
                sideGap: 22,
                betweenGap: 11,
                units: [
                  { name: '1도어', w: 649 },
                  { name: '1도어', w: 649 },
                  { name: '1도어', w: 649 },
                ],
              },
              {
                id: 'lg_builtin_mood',
                name: '무드냉장+무드김치',
                w: 1612,
                h: 1860,
                d: 698,
                type: 'builtin',
                line: 'builtin',
                sideGap: 22,
                betweenGap: 11,
                units: [
                  { name: '무드냉장', w: 897 },
                  { name: '무드김치', w: 649 },
                ],
              },
            ],
            프리스탠딩: [
              {
                id: 'lg_free_600_side',
                name: '냉장고600 양문형',
                w: 913,
                h: 1790,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '양문형600', w: 913 }],
              },
              {
                id: 'lg_free_800_side',
                name: '냉장고800 양문형',
                w: 913,
                h: 1820,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '양문형800', w: 913 }],
              },
              {
                id: 'lg_free_800_topbot',
                name: '냉장고800 상냉장하냉동',
                w: 913,
                h: 1820,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '상하냉장', w: 913 }],
              },
            ],
            모던엣지: [
              {
                id: 'lg_modern_1d1d',
                name: '모던엣지+1도어×2',
                w: 1198,
                h: 1850,
                d: 680,
                type: 'builtin',
                line: 'fitmax',
                sideGap: 4,
                betweenGap: 8,
                units: [
                  { name: '모던엣지', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
            ],
          },
        },
        Samsung: {
          name: '삼성',
          categories: {
            'Bespoke 냉장고': [
              {
                id: 'ss_bespoke_1d',
                name: '1도어 키친핏',
                w: 595,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [{ name: '1도어', w: 595 }],
              },
              {
                id: 'ss_bespoke_2d',
                name: '2도어 키친핏',
                w: 595,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [{ name: '2도어', w: 595 }],
              },
              {
                id: 'ss_bespoke_4d',
                name: '4도어 키친핏',
                w: 912,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [{ name: '4도어', w: 912 }],
              },
            ],
            'Bespoke 김치플러스': [
              {
                id: 'ss_kimchi_1d',
                name: '1도어 키친핏',
                w: 595,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [{ name: '김치1도어', w: 595 }],
              },
              {
                id: 'ss_kimchi_3d',
                name: '3도어 키친핏',
                w: 695,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [{ name: '김치3도어', w: 695 }],
              },
              {
                id: 'ss_kimchi_4d',
                name: '4도어 키친핏',
                w: 912,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [{ name: '김치4도어', w: 912 }],
              },
            ],
            'Bespoke 키친핏 세트': [
              {
                id: 'ss_kf_2d1d',
                name: '2도어+1도어',
                w: 1200,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '2도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_kf_4d1d',
                name: '4도어+1도어',
                w: 1517,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '4도어', w: 912 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_kf_4d3d',
                name: '4도어+3도어',
                w: 1617,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '4도어', w: 912 },
                  { name: '3도어', w: 695 },
                ],
              },
              {
                id: 'ss_kf_4d3d1d',
                name: '4도어+3도어+1도어',
                w: 2222,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '4도어', w: 912 },
                  { name: '3도어', w: 695 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_kf_1d3',
                name: '1도어×3',
                w: 1805,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_kf_1d4',
                name: '1도어×4',
                w: 2410,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_kf_max',
                name: 'Max 4도어+4도어',
                w: 1834,
                h: 1853,
                d: 688,
                type: 'builtin',
                line: 'bespoke',
                sideGap: 12,
                betweenGap: 10,
                units: [
                  { name: '4도어', w: 912 },
                  { name: '4도어', w: 912 },
                ],
              },
            ],
            'Bespoke 프리스탠딩': [
              {
                id: 'ss_bespoke_4d_free',
                name: '4도어 프리스탠딩',
                w: 912,
                h: 1853,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '4도어FS', w: 912 }],
              },
              {
                id: 'ss_kimchi_4d_free',
                name: '김치 4도어 프리스탠딩',
                w: 912,
                h: 1853,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '김치4도어FS', w: 912 }],
              },
            ],
            'Infinite Line 냉장고': [
              {
                id: 'ss_inf_1d',
                name: '1도어 키친핏',
                w: 595,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [{ name: '1도어', w: 595 }],
              },
              {
                id: 'ss_inf_4d',
                name: '4도어 키친핏',
                w: 912,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [{ name: '4도어', w: 912 }],
              },
            ],
            'Infinite Line 김치플러스': [
              {
                id: 'ss_inf_kimchi_1d',
                name: '1도어 키친핏',
                w: 595,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [{ name: '김치1도어', w: 595 }],
              },
              {
                id: 'ss_inf_kimchi_4d',
                name: '4도어 키친핏',
                w: 912,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [{ name: '김치4도어', w: 912 }],
              },
            ],
            'Infinite Line 키친핏 세트': [
              {
                id: 'ss_inf_1d1d',
                name: '1도어+1도어',
                w: 1200,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_inf_1d3',
                name: '1도어×3',
                w: 1815,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_inf_1d4',
                name: '1도어×4',
                w: 2420,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                  { name: '1도어', w: 595 },
                ],
              },
              {
                id: 'ss_inf_4d4d',
                name: '4도어+4도어',
                w: 1834,
                h: 1855,
                d: 688,
                type: 'builtin',
                line: 'infinite',
                sideGap: 5,
                betweenGap: 10,
                units: [
                  { name: '4도어', w: 912 },
                  { name: '4도어', w: 912 },
                ],
              },
            ],
            'Infinite Line 프리스탠딩': [
              {
                id: 'ss_inf_4d_free',
                name: '4도어 프리스탠딩',
                w: 912,
                h: 1855,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '4도어FS', w: 912 }],
              },
            ],
            '김치플러스 스탠드': [
              {
                id: 'ss_stand_3d',
                name: '스탠드형 3도어',
                w: 595,
                h: 1380,
                d: 688,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '스탠드3도어', w: 595 }],
              },
              {
                id: 'ss_stand_4d',
                name: '스탠드형 4도어',
                w: 595,
                h: 1530,
                d: 688,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: '스탠드4도어', w: 595 }],
              },
            ],
            양문형: [
              {
                id: 'ss_rs70',
                name: 'RS70',
                w: 912,
                h: 1780,
                d: 716,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: 'RS70', w: 912 }],
              },
              {
                id: 'ss_rs80f',
                name: 'RS80F',
                w: 912,
                h: 1780,
                d: 716,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: 'RS80F', w: 912 }],
              },
              {
                id: 'ss_rs84',
                name: 'RS84',
                w: 912,
                h: 1825,
                d: 738,
                type: 'freestanding',
                line: 'freestanding',
                sideGap: 50,
                betweenGap: 0,
                units: [{ name: 'RS84', w: 912 }],
              },
            ],
          },
        },
      };

      // ★ EL장 도어 타입 (5가지)
      const EL_DOOR_TYPES = [
        { id: 'liftup', name: '리프트업' },
        { id: 'flap', name: '플랩도어' },
        { id: 'pocket', name: '포켓도어' },
        { id: 'swing', name: '여닫이' },
        { id: 'sliding', name: '슬라이딩' },
      ];

      // ★ 도어 구분 타입 (3가지)
      const DOOR_DIVISION_TYPES = [
        { id: 'individual', name: '개별' },
        { id: 'midLower', name: '중간장ㆍ하부장' },
        { id: 'all', name: '전체' },
      ];

      // ★ 마감 타입 (몰딩, 휠라, EP, 없음)
      const FINISH_TYPES = [
        { id: 'Molding', name: '몰딩', defaultW: 60, editable: true },
        { id: 'Filler', name: '휠라', defaultW: 60, editable: true },
        { id: 'EP', name: 'EP', defaultW: 20, editable: false },
        { id: 'None', name: '없음', defaultW: 0, editable: false },
      ];

      // ★ 도어 색상 매핑
      const DOOR_COLOR_MAP = {
        화이트: '#f5f5f5',
        그레이: '#9e9e9e',
        베이지: '#d4c4b0',
        월넛: '#5d4037',
        오크: '#c4a35a',
      };

      function getDoorColor(colorName) {
        return DOOR_COLOR_MAP[colorName] || '#f5f5f5';
      }

      // ★ 하부장 모듈 타입
      const LOWER_MODULE_TYPES = [
        { id: 'default', name: '기본', defaultW: 600, color: '#6b7280', icon: '🗄️' },
        { id: 'robot', name: '로봇청소기', defaultW: 600, color: '#f59e0b', icon: '🤖' },
        { id: 'foodwaste', name: '음식물처리기', defaultW: 450, color: '#22c55e', icon: '♻️' },
        { id: 'rice', name: '밥솥', defaultW: 450, color: '#ef4444', icon: '🍚' },
      ];

