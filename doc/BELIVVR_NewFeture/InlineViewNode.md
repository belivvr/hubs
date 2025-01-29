# InlineViewNode
BELIVVR에서 개발한 InlineView Node 컴포넌트 분석 문서

## 1. 개요
url웹 콘텐츠를 HUBS의 메인, 사이드 영역, 새창에 프레임을 고정하여 프레임을 표시하기 위한 컴포넌트입니다. Link컴포넌트와 유사하지만 보다 확장된 기능들을 제공합니다.

## 1.1 용어 구분
이 문서에서 사용되는 두 가지 주요 용어를 구분하여 이해할 필요가 있습니다:

1. InlineView (Spoke 에디터)
   - Spoke 에디터에서 사용되는 노드의 이름
   - InlineViewNode.js에 정의된 에디터용 클래스
   - 씬 저장/불러오기에 사용되는 직렬화 포맷의 이름

2. inline-frame (Hubs 런타임)
   - Hubs에서 실제 동작하는 A-Frame 컴포넌트
   - InlineView 노드가 GLTF로 export될 때 변환되는 컴포넌트
   - 실제 웹 콘텐츠를 표시하고 제어하는 런타임 컴포넌트

이러한 구분은 에디터와 런타임의 관심사 분리를 위한 의도된 설계입니다.

## 2. 핵심 파일 구조

### 2.1 에디터 노드 정의
**파일: spoke/src/editor/nodes/InlineViewNode.js**

```javascript
export default class InlineViewNode extends EditorNodeMixin(Image) {
static componentName = "Inline View";
static nodeName = "Inline View";
constructor(editor) {
super(editor);
this.canonicalUrl = ""; // 썸네일 이미지 URL
this.inlineURL = ""; // 실제 표시될 웹 콘텐츠 URL
this.frameOption = "Main"; // 프레임 표시 옵션
this.billboard = false; // 빌보드 효과 여부

}
}
```

주요 메서드:
- `deserialize()`: 저장된 노드 데이터 복원
- `prepareForExport()`: GLTF 내보내기 준비
- `copy()`: 노드 복제
- `serialize()`: 노드 데이터 저장

### 2.2 버튼 컴포넌트
**파일: hubs/src/components/inline-frame-button.js**

```javascript
AFRAME.registerComponent("inline-frame-button", {
  schema: {
    name: { default: "" },       // 프레임 이름
    src: { default: "" },        // 웹 콘텐츠 URL
    frameOption: { default: "" } // 표시 옵션
  }
});
```

기능:
- 클릭 이벤트 처리
- XRCLOUD 로깅
- inline-url 커스텀 이벤트 발생

### 2.3 GLTF 컴포넌트 매핑
**파일: hubs/src/gltf-component-mappings.js**

```javascript
AFRAME.GLTFModelPlus.registerComponent("inline-frame", "inline-frame", 
  async (el, componentName, componentData, components) => {
    // 네트워크 동기화 설정
    el.setAttribute("networked", {
      template: "#inline-static-controlled-media",
      owner: "scene",
      persistent: true,
      networkId: components.networked.id
    });

    // 미디어 이미지 설정
    el.setAttribute("media-image", {
      src: componentData.imageURL,
      version: 1,
      contentType: guessContentType(componentData.imageURL) || "image/png"
    });
});
```

### 2.4 미디어 로더 통합
**파일: hubs/src/components/media-loader.js**
- 인라인 프레임 미디어 처리 로직
- 썸네일 이미지 로딩
- hover 메뉴 설정
- 프레임 버튼 설정

### 2.5 HTML 템플릿
**파일: hubs/src/hub.html**
```html
<template id="inline-hover-menu">
  <a-entity id="inline-wrapper" class="ui interactable-ui hover-container">
    <a-entity id="inline-frame-button" 
              mixin="rounded-text-action-button ui" 
              inline-frame-button="src:''; frameOption:'';">
      <a-entity text="value:open frame; textAlign:center;">
      </a-entity>
    </a-entity>
  </a-entity>
</template>
```

## 3. 동작 방식

### 3.1 프레임 옵션
- `main`: 메인 뷰에 표시
- `sideView`: 사이드 뷰에 표시
- `newWindow`: 새 창에서 열기
- `selfWindow`: 현재 창에서 열기 (기본값)

### 3.2 초기화 프로세스
1. InlineViewNode 인스턴스 생성
2. 썸네일 이미지 로드
3. 프레임 옵션 및 URL 설정
4. 네트워크 동기화 설정
5. hover 메뉴 초기화

### 3.3 이벤트 흐름
1. 사용자가 썸네일 hover
2. hover 메뉴 표시
3. 프레임 버튼 클릭
4. XRCLOUD 로그 기록
5. inline-url 이벤트 발생
6. 프레임 옵션에 따른 콘텐츠 표시

## 4. 네트워크 동기화

### 4.1 기본 설정
- networked-aframe 컴포넌트 사용
- 템플릿: #inline-static-controlled-media
- persistent 속성으로 상태 유지

### 4.2 동기화 데이터
- 프레임 위치/회전/크기
- 썸네일 이미지 상태
- 프레임 옵션
- 웹 콘텐츠 URL

## 5. 사용 시 주의사항

### 5.1 프레임 옵션
- 지정된 옵션값만 사용
- 잘못된 값 입력 시 selfWindow로 설정됨
- 옵션 변경 시 즉시 반영

### 5.2 리소스 관리
- 썸네일 이미지 최적화 필요
- 적절한 이미지 크기 사용
- 동시 표시 프레임 수 제한 고려

### 5.3 네트워크 설정
- networked 컴포넌트 필수
- 올바른 템플릿 ID 사용
- 네트워크 권한 확인

### 5.4 성능 고려사항
- 과도한 프레임 사용 자제
- 리소스 로딩 최적화
- 메모리 사용량 모니터링
