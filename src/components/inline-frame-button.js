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
    this.label = this.el.querySelector("[text]");
    
    if (this.label) {
      this.label.setAttribute("text", {
        value: this.data.buttonText
      });
    }

    // Separate common handler for click/proximity
    this.handleInteraction = async () => {
      if (this.data.contentType === "avatar") {
        window.APP.store.update({
          profile: { avatarId: this.data.src }
        });
        
        const scene = document.querySelector("a-scene");
        scene.emit("avatar_updated");
      } else {
        // Handle URL
        if (this.data.selfWindow) {
          window.location.href = this.data.src;
        } else {
          const hubId = this.data.src.match(/\/hub\.link\/(\d+)/) || this.data.src.match(/\/room\/(\d+)/);
          if (hubId) {
            const roomId = hubId[1];
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

    this.onClick = () => {
      this.handleInteraction();
    };

    NAF.utils.getNetworkedEntity(this.el).then(networkedEl => {
      this.targetEl = networkedEl;
    });

    if (this.data.triggerMode === "click") {
      this.el.object3D.addEventListener("interact", this.onClick);
    } else if (this.data.triggerMode === "proximity") {
      this.tick = AFRAME.utils.throttleTick(this.tick, 1000, this);
    }

    this.wasInRange = false;
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
    
    if (isInRange && !this.wasInRange) {
      this.handleInteraction();
    } else if (!isInRange && this.wasInRange) {
      if (this.data.frameOption === "sideView") {
        this.handleInteraction();
      }
    }
    this.wasInRange = isInRange;
  }
});
