import { ACTION_TYPES, getAccountId, logToXRCLOUD } from "../belivvr/logAction";

AFRAME.registerComponent("inline-frame-button", {
  schema: {
    name: { default: "" },
    src: { default: "" },
    frameOption: { default: "" },
    contentType: { default: "url" },  // "url" | "avatar"
    triggerMode: { default: "click" }, // "click" | "proximity"
    triggerDistance: { default: 2 },
    buttonText: { default: "Open Frame" },
    selfWindow: { default: false }
  },

  init() {
    console.log("[inline-frame-button] Initializing with data:", this.data);
    
    this.label = this.el.querySelector("[text]");
    
    if (this.label) {
      this.label.setAttribute("text", {
        value: this.data.buttonText
      });
    }

    // 클릭/근접 공통 핸들러로 분리
    this.handleInteraction = async () => {
      if (this.data.contentType === "avatar") {
        console.log("[inline-frame-button] Changing avatar with src:", this.data.src);
        
        window.APP.store.update({
          profile: { avatarId: this.data.src }
        });
        
        console.log("[inline-frame-button] Avatar updated, new state:", window.APP.store.state.profile);
        
        const scene = document.querySelector("a-scene");
        scene.emit("avatar_updated");
      } else {
        // URL 처리
        console.log("[inline-frame-button] Opening URL with details:", {
          name: this.data.name,
          url: this.data.src,
          option: this.data.frameOption
        });
        
        if (this.data.selfWindow) {
          // 일반 URL: `selfWindow: true` 상태를 설정하여 일반적인 페이지 이동 처리
          window.location.href = this.data.src;
        } else {
          // Room URL: `/hub.link/` 또는 `/room`을 포함하는 URL인 경우
          // `hubIdFromUrl`로 룸 ID를 추출
          // `changeHub` 함수를 사용하여 페이지 리로딩 없이 룸 이동
          // 이는 Link 컴포넌트와 동일한 방식으로 동작하여 부드러운 룸 전환 제공
          const hubId = this.data.src.match(/\/hub\.link\/(\d+)/) || this.data.src.match(/\/room\/(\d+)/);
          if (hubId) {
            const roomId = hubId[1];
            console.log("[inline-frame-button] Detected room ID:", roomId);
            window.APP.changeHub(roomId);
          } else {
            window.dispatchEvent(new CustomEvent("inline-url", {
              detail: {
                name: this.data.name,
                url: this.data.src,
                option: this.data.frameOption
              }
            }));
          }
        }

        // XRCLOUD 로깅
        const date = new Date();
        const accountId = await getAccountId();
        logToXRCLOUD({
          type: ACTION_TYPES.OPEN_INLINE_URL,
          eventTime: date,
          roomId: window.APP.hubChannel.hubId,
          userId: accountId,
          eventAction: `inline-frame ${ACTION_TYPES.OPEN_INLINE_URL}: ${this.data.src}`
        });
      }
    };

    // 클릭 이벤트용 래퍼
    this.onClick = () => {
      this.handleInteraction();
    };

    NAF.utils.getNetworkedEntity(this.el).then(networkedEl => {
      this.targetEl = networkedEl;
    });

    // 클릭 이벤트 리스너 등록
    if (this.data.triggerMode === "click") {
      this.el.object3D.addEventListener("interact", this.onClick);
    } else if (this.data.triggerMode === "proximity") {
      console.log("[inline-frame-button] Proximity mode enabled with distance:", this.data.triggerDistance);
      this.tick = AFRAME.utils.throttleTick(this.tick, 1000, this);
    }

    this.wasInRange = false;  // 범위 체크용 플래그 추가
  },

  update(oldData) {
    console.log("[inline-frame-button] Updating component", {
      oldData,
      newData: this.data
    });
  },

  remove() {
    if (this.data.triggerMode === "click") {
      this.el.object3D.removeEventListener("interact", this.onClick);
    } else if (this.data.triggerMode === "proximity") {
      this.el.removeEventListener("proximityenter", this.onProximityEnter);
    }
  },

  play() {
    this.el.object3D.addEventListener("interact", this.onClick);
  },

  pause() {
    this.el.object3D.removeEventListener("interact", this.onClick);
  },

  tick() {
    if (this.data.triggerMode !== "proximity") return;
    
    const avatar = document.getElementById("avatar-rig");
    if (!avatar) return;

    const distanceVec = new THREE.Vector3();
    const avatarPos = new THREE.Vector3();
    const buttonPos = new THREE.Vector3();

    avatar.object3D.getWorldPosition(avatarPos);
    this.el.object3D.getWorldPosition(buttonPos);
    
    const distance = distanceVec.subVectors(buttonPos, avatarPos).length();
    const isInRange = distance <= this.data.triggerDistance;
    
    // 범위 안에 처음 들어왔을 때만 트리거
    if (isInRange && !this.wasInRange) {
      console.log("[inline-frame-button] Entered trigger range, distance:", distance);
      this.handleInteraction();
    } else if (!isInRange && this.wasInRange) {
      console.log("[inline-frame-button] Left trigger range, frameOption:", this.data.frameOption);
      
      // Side view 닫기 이벤트 발생 시 디버그 로그 추가
      if (this.data.frameOption === "sideView") {  // 대소문자 확인
        console.log("[inline-frame-button] Attempting to close Side view sidebar");
        this.handleInteraction();
        console.log("[inline-frame-button] Dispatched close sidebar event");
      }
    }
    this.wasInRange = isInRange;  // 상태 업데이트 확인
  }
});
