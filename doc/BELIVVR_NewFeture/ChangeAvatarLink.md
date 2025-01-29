** 제목 ** 아바타 변경 링크
* 개발자 : fstory97@gmail.com
* Work Period : 2025-01-29 ~ 2025-02-01

** 현재현황 **
Use Avatar 는 Hubs내에 원래 있던 기능으로 생각됩니다. Mozilla Hubs에서 공개했던 일부 Scene에서 사용자 아바타를 사용할 수 있는 기능을 본적은 있으나 이러한 Scene을 만들려면어떻게 해야 하는지, 아바타를 어떻게 배치할 수 있는지 확인된 바가 없었습니다. BELIVVR에서 구현했던 InlineFrame 컴포넌트의 링크 기능을 이용하여 아바타의링크를 설정하여 사용자 아바타가 변경하게 하려 합니다.

** 개발현황 **

1. 초기 테스트 (2025-01-29)
- hubs/src/components/inline-frame-button.js 에 아바타 변경 테스트를 진행함
- window.APP.store를 통한 아바타 변경 기능 확인

2. Spoke 에디터 기능 확장 (2025-01-30)
- InlineViewNode에 새로운 속성 추가
  - contentType: "url" | "avatar" 구분
  - triggerMode: "click" | "proximity" 구분
  - triggerDistance: proximity 트리거 거리
  - buttonText: 버튼에 표시될 텍스트

3. InlineViewNode 코드 수정 (2025-01-30)
- constructor에 새 속성 추가
- deserialize에 새 속성 로드 추가
- serialize에 새 속성 추가
- copy에 새 속성 복사 추가
- prepareForExport에 새 속성 추가

4. 아바타 변경 기능 구현 완료 (2025-02-01)
- contentType이 "avatar"일 때 아바타 변경 로직 구현
- GLB 파일 검증 로직 추가
- 버튼 텍스트 자동 변경 ("Change Avatar")
- frameOption 비활성화 (아바타 모드에서는 불필요)

** 남은 작업 **
1. proximity 트리거 구현 예정
   - 거리 기반 트리거 로직 구현
   - 성능 최적화 고려

2. 피드백 개선
   - 아바타 변경 시 사용자 피드백 추가
   - 로딩 상태 표시
   - 에러 처리 개선
 