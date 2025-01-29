# InlineViewNode 개발 문서
 * 개발자 : fstory97@gmail.com / (luke.yang@belivvr.com) BELIVVR INC
 

## 1. 아키텍처 개요

### 1.1 컴포넌트 구조
1. Spoke 에디터 (InlineViewNode)
   - 씬 제작 시점의 노드
   - 속성 편집 및 저장/불러오기 담당
   - 파일: spoke/src/editor/nodes/InlineViewNode.js

2. Hubs 런타임 (inline-frame-button)
   - 실제 동작하는 A-Frame 컴포넌트
   - 이벤트 처리 및 상태 관리
   - 파일: hubs/src/components/inline-frame-button.js

### 1.2 데이터 흐름
1. 에디터 → GLTF → 런타임
   - InlineViewNode 속성이 GLTF로 직렬화
   - GLTF 로드 시 inline-frame-button으로 변환
   - gltf-component-mappings.js가 변환 처리

2. 이벤트 처리
   - Click/Proximity 트리거 → onClick 핸들러
   - URL 모드: inline-url 이벤트 발생
   - Avatar 모드: 아바타 상태 업데이트

## 2. 주요 컴포넌트 상세

### 2.1 InlineViewNode (Spoke)
```javascript
class InlineViewNode {
  // 기본 속성
  this._canonicalUrl = "";    // 썸네일 이미지
  this.inlineURL = "";       // 콘텐츠 URL
  this.frameOption = "Main"; // 표시 옵션
  this.contentType = "url";  // url | avatar
  this.triggerMode = "click";// click | proximity
  this.triggerDistance = 2;  // 미터 단위
  this.buttonText = "Open Frame";

  // 핵심 메서드
  serialize()       // 씬 저장
  deserialize()     // 씬 로드
  prepareForExport()// GLTF 변환
}
```

### 2.2 inline-frame-button (Hubs)
```javascript
AFRAME.registerComponent("inline-frame-button", {
  // 스키마 정의
  schema: {
    name: { default: "" },
    src: { default: "" },
    frameOption: { default: "" },
    contentType: { default: "url" },
    triggerMode: { default: "click" },
    triggerDistance: { default: 2 },
    buttonText: { default: "Open Frame" }
  },

  // 주요 메서드
  init()      // 초기화 및 이벤트 설정
  onClick()   // 버튼 동작 처리
  tick()      // proximity 체크 (1초 간격)
});
```

## 3. 주요 기능 구현

### 3.1 URL 처리
```javascript
// 커스텀 이벤트 발생
window.dispatchEvent(new CustomEvent("inline-url", {
  detail: {
    name: this.data.name,
    url: this.data.src,
    option: this.data.frameOption
  }
}));

// XRCLOUD 로깅
logToXRCLOUD({
  type: ACTION_TYPES.OPEN_INLINE_URL,
  eventTime: date,
  roomId: window.APP.hubChannel.hubId,
  userId: accountId,
  eventAction: `inline-frame ${ACTION_TYPES.OPEN_INLINE_URL}: ${this.data.src}`
});
```

### 3.2 아바타 변경
```javascript
window.APP.store.update({
  profile: { avatarId: this.data.src }
});
scene.emit("avatar_updated");
```

### 3.3 Proximity 처리
```javascript
// 거리 체크 (tick 함수에서)
const distance = distanceVec.subVectors(buttonPos, avatarPos).length();
const isInRange = distance <= this.data.triggerDistance;

if (isInRange && !this.wasInRange) {
  this.onClick();
}
this.wasInRange = isInRange;
```

## 4. 확장 포인트

### 4.1 새로운 트리거 모드 추가
1. schema에 새로운 트리거 모드 추가
2. init()에서 해당 모드 처리 로직 구현
3. 필요시 tick() 함수 활용

### 4.2 새로운 콘텐츠 타입 추가
1. contentType에 새로운 타입 추가
2. onClick 핸들러에서 분기 처리
3. 필요한 이벤트 발생 구현

### 4.3 로깅 확장
1. ACTION_TYPES에 새로운 타입 추가
2. logToXRCLOUD 호출 시 eventAction 포맷 정의
3. 필요한 추가 데이터 포함

## 5. 테스트 포인트
1. URL 모드 동작 검증
2. 아바타 변경 검증
3. Proximity 트리거 동작
4. XRCLOUD 로깅 확인
5. 씬 저장/로드 시 속성 유지

## 6. 현재 진행중인 이슈

### 6.1 Proximity 트리거에서 URL 이동 문제
- 현재 상태: proximity 모드에서 아바타 변경만 동작하고 URL 이동은 동작하지 않음
- 해결 방향: 코드 검토 및 수정 필요

### 6.2 Room 이동 시 페이드 효과 누락
- 현재 상태: self 옵션으로 room 이동 시 페이드 인/아웃 효과가 없음
- 참고 코드: scene-loading.ts의 페이드 처리
  ```typescript
  const fader = (document.getElementById("viewing-camera")! as AElement).components["fader"];
  (fader as any).fadeIn();
  ```
- 해결 방향: 
  1. 링크 컴포넌트의 room URL 처리 방식 분석
  2. 페이드아웃 -> 씬 로드 -> 페이드인 순서 구현 필요

### 6.3 다음 단계
1. 링크 컴포넌트 코드 분석
2. room URL 감지 및 처리 로직 파악
3. inline-frame-button에 동일 기능 구현

