import { ACTION_TYPES, getAccountId, logToXRCLOUD } from "../belivvr/logAction";

AFRAME.registerComponent("inline-frame-button", {
  schema: {
    name: { default: "" },
    src: { default: "" },
    frameOption: { default: "" },
    contentType: { default: "url" },  // "url" | "avatar"
    triggerMode: { default: "click" }, // "click" | "proximity"
    triggerDistance: { default: 2 },
    buttonText: { default: "Open Frame" }
  },

  init() {
    console.log("[inline-frame-button] Initializing with data:", {
      name: this.data.name,
      src: this.data.src,
      frameOption: this.data.frameOption,
      contentType: this.data.contentType,
      triggerMode: this.data.triggerMode,
      triggerDistance: this.data.triggerDistance,
      buttonText: this.data.buttonText
    });
    
    this.label = this.el.querySelector("[text]");
    
    if (this.label) {
      this.label.setAttribute("text", {
        value: this.data.buttonText
      });
    }

    this.onClick = () => {
      if (this.data.contentType === "avatar") {
        console.log("[inline-frame-button] Changing avatar with src:", this.data.src);
        
        window.APP.store.update({
          profile: { avatarId: this.data.src }
        });
        
        console.log("[inline-frame-button] Avatar updated, new state:", window.APP.store.state.profile);
        
        const scene = document.querySelector("a-scene");
        scene.emit("avatar_updated");
      } else {
        console.log("[inline-frame-button] Opening URL with details:", {
          name: this.data.name,
          url: this.data.src,
          option: this.data.frameOption
        });
        
        window.dispatchEvent(new CustomEvent("inline-url", {
          detail: {
            url: this.data.src,
            name: this.data.name,
            option: this.data.frameOption
          }
        }));
      }
    };

    NAF.utils.getNetworkedEntity(this.el).then(networkedEl => {
      this.targetEl = networkedEl;
    });

    // 클릭 이벤트 리스너 등록
    if (this.data.triggerMode === "click") {
      this.el.object3D.addEventListener("interact", this.onClick);
    } else if (this.data.triggerMode === "proximity") {
      console.log("[inline-frame-button] Setting up proximity trigger with distance:", this.data.triggerDistance);
      
      this.onProximityEnter = () => {
        console.log("[inline-frame-button] Proximity enter detected");
        const distance = this.el.object3D.position.distanceTo(this.targetEl.object3D.position);
        console.log("[inline-frame-button] Current distance:", distance);
        
        if (distance <= this.data.triggerDistance) {
          console.log("[inline-frame-button] Within trigger distance, activating...");
          this.onClick();
        }
      };

      // object3D 대신 el에 직접 이벤트 리스너 추가
      this.el.addEventListener("proximityenter", this.onProximityEnter);
    }
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
  }
});
