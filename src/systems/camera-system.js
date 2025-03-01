import { waitForDOMContentLoaded } from "../utils/async-utils";
import { childMatch, setMatrixWorld, calculateViewingDistance, getLastWorldQuaternion } from "../utils/three-utils";
import { paths } from "./userinput/paths";
import { getBox } from "../utils/auto-box-collider";
import qsTruthy from "../utils/qs_truthy";
import { isTagged } from "../components/tags";
import { qsGet } from "../utils/qs_truthy";
const customFOV = qsGet("fov");
const enableThirdPersonMode = qsTruthy("thirdPerson");
import { Layers } from "../camera-layers";
import { HoveredRemoteRight, Inspectable, Inspected, LocalAvatar, RemoteAvatar } from "../bit-components";
import {
  anyEntityWith,
  findAncestorWithAnyComponent,
  findAncestorWithComponent,
  shouldUseNewLoader
} from "../utils/bit-utils";
import { addComponent, defineQuery, removeComponent } from "bitecs";
import { INSPECTABLE_FLAGS } from "../bit-systems/inspect-system";


function setObjectPositionFromMatrix(object, matrix) {
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  // Extract position and scale from the matrix
  matrix.decompose(position, new THREE.Quaternion(), scale);

  if (object.parent) {
    // Convert to relative position considering the parent's position
    const parentPosition = new THREE.Vector3();
    object.parent.updateMatrixWorld();
    object.parent.matrixWorld.decompose(parentPosition, new THREE.Quaternion(), new THREE.Vector3());
    position.sub(parentPosition);
  }

  position.y += 1.6; // Raise by avatar height
  object.position.copy(position);
  object.scale.copy(scale); // Apply scale
}

function getInspectableInHierarchy(eid) {
  let inspectable = findAncestorWithComponent(APP.world, Inspectable, eid);
  if (!inspectable) {
    console.warn("could not find inspectable in hierarchy");
    inspectable = eid;
  }
  return APP.world.eid2obj.get(inspectable);
}

function getInspectableInHierarchyAframe(el) {
  let inspectable = el;
  while (inspectable) {
    if (isTagged(inspectable, "inspectable")) {
      return inspectable.object3D;
    }
    inspectable = inspectable.parentNode;
  }
  console.warn("could not find inspectable in hierarchy");
  return el.object3D;
}

function pivotFor(el) {
  const selector =
    el.components["inspect-pivot-child-selector"] && el.components["inspect-pivot-child-selector"].data.selector;
  if (!selector) {
    return el.object3D;
  }

  const child = el.querySelector(selector);
  if (!child) {
    console.error(`Failed to find pivot for selector: ${selector}`, el);
    return el.object3D;
  }
  return child.object3D;
}

function getInspectableAndPivot(eid) {
  const inspectable = getInspectableInHierarchy(eid);
  let pivot;
  if (findAncestorWithAnyComponent(APP.world, [RemoteAvatar, LocalAvatar], eid)) {
    // TODO Until avatars are migrated we still handle pivot using the AFrame element
    pivot = pivotFor(inspectable.el);
  } else {
    pivot = inspectable;
  }
  return { inspectable, pivot };
}

function getInspectableAndPivotAframe(el) {
  const inspectable = getInspectableInHierarchyAframe(el);
  const pivot = pivotFor(inspectable.el);
  return { inspectable, pivot };
}

const decompose = (function () {
  const scale = new THREE.Vector3();
  return function decompose(m, p, q) {
    m.decompose(p, q, scale); //ignore scale, like we're dealing with a motor
  };
})();

const IDENTITY = new THREE.Matrix4().identity();
const V_ONE = new THREE.Vector3(1, 1, 1);
const orbit = (function () {
  const owq = new THREE.Quaternion();
  const owp = new THREE.Vector3();
  const cwq = new THREE.Quaternion();
  const cwp = new THREE.Vector3();
  const rwq = new THREE.Quaternion();
  const UP = new THREE.Vector3();
  const RIGHT = new THREE.Vector3();
  const dPos = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  const targetScale = new THREE.Vector3(1, 1, 1);
  const targetMatrix = new THREE.Matrix4();
  const dhQ = new THREE.Quaternion();
  const dvQ = new THREE.Quaternion();
  return function orbit(pivot, rig, camera, dh, dv, dz, dt, panY) {
    if (pivot instanceof THREE.Object3D) {
      pivot.updateMatrixWorld();
      decompose(pivot.matrixWorld, owp, owq);
    } else {
      console.warn("Pivot is not an instance of THREE.Object3D");
    }

    if (camera instanceof THREE.Object3D) {
      camera.updateMatrixWorld();
      decompose(camera.matrixWorld, cwp, cwq);
    } else {
      console.warn("Camera is not an instance of THREE.Object3D");
    }

    rig.getWorldQuaternion(rwq);

    dhQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.1 * dh * dt);
    targetQuat.copy(cwq).premultiply(dhQ);
    dPos.subVectors(cwp, owp);
    const zoom = 1 - dz * dt;
    const newLength = dPos.length() * zoom;
    if (newLength > 0.1 && newLength < 100) {
      dPos.multiplyScalar(zoom);
    }

    dvQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(targetQuat), 0.1 * dv * dt);
    targetQuat.premultiply(dvQ);
    targetPos.addVectors(owp, dPos.applyQuaternion(dhQ).applyQuaternion(dvQ)).add(
      new THREE.Vector3(0, 1, 0)
        .multiplyScalar(panY * newLength)
        .applyQuaternion(targetQuat)
    );

    targetMatrix.compose(targetPos, targetQuat, targetScale);

    childMatch(rig, camera, targetMatrix);
  };
})();

const moveRigSoCameraLooksAtPivot = (function () {
  const owq = new THREE.Quaternion();
  const owp = new THREE.Vector3();
  const cwq = new THREE.Quaternion();
  const cwp = new THREE.Vector3();
  const oForw = new THREE.Vector3();
  const center = new THREE.Vector3();
  const defaultBoxMax = new THREE.Vector3(0.3, 0.3, 0.3);
  const target = new THREE.Object3D();
  return function moveRigSoCameraLooksAtPivot(rig, camera, inspectable, pivot, distanceMod) {
    if (!target.parent) {
      // add dummy object to the scene, if this is the first time we call this function
      AFRAME.scenes[0].object3D.add(target);
      target.applyMatrix4(IDENTITY); // make sure target gets updated at least once for our matrix optimizations
    }

    pivot.updateMatrices();
    decompose(pivot.matrixWorld, owp, owq);
    decompose(camera.matrixWorld, cwp, cwq);
    rig.getWorldQuaternion(cwq);

    const box = getBox(inspectable, inspectable, true);
    if (box.min.x === Infinity) {
      // fix edgecase where inspectable object has no mesh / dimensions
      box.min.subVectors(owp, defaultBoxMax);
      box.max.addVectors(owp, defaultBoxMax);
    }
    box.getCenter(center);
    const vrMode = APP.scene.is("vr-mode");
    const dist =
      calculateViewingDistance(APP.scene.camera.fov, APP.scene.camera.aspect, box, center, vrMode) * distanceMod;
    target.position.addVectors(
      owp,
      oForw
        .set(0, 0, 1) //TODO: Suspicious that this is called oForw but (0,0,1) is backwards
        .multiplyScalar(dist)
        .applyQuaternion(owq)
    );
    target.quaternion.copy(owq);
    target.matrixNeedsUpdate = true;
    target.updateMatrices();
    childMatch(rig, camera, target.matrixWorld);
  };
})();

export const CAMERA_MODE_FIRST_PERSON = 0;
export const CAMERA_MODE_THIRD_PERSON_NEAR = 1;
export const CAMERA_MODE_THIRD_PERSON_FAR = 2;
export const CAMERA_MODE_INSPECT = 3;
export const CAMERA_MODE_SCENE_PREVIEW = 4;
export const CAMERA_MODE_THIRD_PERSON_VIEW = 5; // [BELIVVR Custom, Third-Person View] Define a new camera mode for third-person view
const THIRD_PERSON_VIEW_DISTANCE = 2; // [BELIVVR Custom, Third-Person View] Set the default distance for third-person view

const NEXT_MODES = {
  [CAMERA_MODE_FIRST_PERSON]: CAMERA_MODE_THIRD_PERSON_NEAR,
  [CAMERA_MODE_THIRD_PERSON_NEAR]: CAMERA_MODE_THIRD_PERSON_FAR,
  [CAMERA_MODE_THIRD_PERSON_FAR]: CAMERA_MODE_FIRST_PERSON
};

const ensureLightsAreSeenByCamera = function (o) {
  if (o.isLight) {
    o.layers.enable(Layers.CAMERA_LAYER_INSPECT);
  }
};

const firstPersonOnlyLayer = new THREE.Layers();
firstPersonOnlyLayer.set(Layers.CAMERA_LAYER_FIRST_PERSON_ONLY);
const enableInspectLayer = function (o) {
  // Ignore first person only meshes
  if (o.layers.test(firstPersonOnlyLayer)) return;
  o.layers.enable(Layers.CAMERA_LAYER_INSPECT);
};
const disableInspectLayer = function (o) {
  // Ignore first person only meshes
  if (o.layers.test(firstPersonOnlyLayer)) return;
  o.layers.disable(Layers.CAMERA_LAYER_INSPECT);
};

function getAudio(o) {
  let audio;
  o.traverse(c => {
    if (!audio && c.type === "Audio") {
      audio = c;
    }
  });
  return audio;
}

const FALLOFF = 0.9;
export class CameraSystem {
  constructor(camera, renderer) {
    this.viewingCamera = camera;
    this.lightsEnabled = localStorage.getItem("show-background-while-inspecting") === "true";
    this.verticalDelta = 0;
    this.horizontalDelta = 0;
    this.inspectZoom = 0;
    this.mode = CAMERA_MODE_SCENE_PREVIEW;
    this.snapshot = { audioTransform: new THREE.Matrix4(), matrixWorld: new THREE.Matrix4() };
    this.audioSourceTargetTransform = new THREE.Matrix4();    

    if (customFOV) {
      this.viewingCamera.fov = customFOV;
    }
    this.viewingCamera.layers.enable(Layers.CAMERA_LAYER_VIDEO_TEXTURE_TARGET);
    this.viewingCamera.layers.enable(Layers.CAMERA_LAYER_FIRST_PERSON_ONLY);
    this.viewingCamera.layers.enable(Layers.CAMERA_LAYER_UI);
    this.viewingCamera.layers.enable(Layers.CAMERA_LAYER_FX_MASK);

    // xr.updateCamera gets called every render to copy the active cameras properties to the XR cameras. We also want to copy layers.
    // TODO this logic should either be moved into THREE or removed when we ditch aframe camera system
    const xrManager = renderer.xr;
    const updateXRCamera = xrManager.updateCamera;
    xrManager.updateCamera = function (camera) {
      updateXRCamera(camera);
      const xrCamera = xrManager.getCamera();
      xrCamera.layers.mask = camera.layers.mask;
      if (xrCamera.cameras.length) {
        xrCamera.cameras[0].layers.set(Layers.CAMERA_LAYER_XR_LEFT_EYE);
        xrCamera.cameras[0].layers.mask |= camera.layers.mask;
        xrCamera.cameras[1].layers.set(Layers.CAMERA_LAYER_XR_RIGHT_EYE);
        xrCamera.cameras[1].layers.mask |= camera.layers.mask;
      }
    };

    waitForDOMContentLoaded().then(() => {
      this.avatarPOV = document.getElementById("avatar-pov-node");
      this.avatarRig = document.getElementById("avatar-rig");
      this.viewingRig = document.getElementById("viewing-rig");

      // Adjust avatar head size when entering VR mode
      APP.scene.addEventListener("enter-vr", () => {
        const checkAvatarHead = () => {
          // Only adjust head size for full-body avatars
          if (window.APP?.hubChannel?.presence?.metas?.[0]?.profile?.avatarType === 'full-body') {
            if (window.myAvatarHead) {
              window.myAvatarHead.scale.set(0, 0, 0);
            } else {
              // Retry until avatar head is loaded (max 3 seconds)
              if (!this.avatarHeadRetryCount) {
                this.avatarHeadRetryCount = 0;
              }
              if (this.avatarHeadRetryCount < 30) { // 100ms * 30 = 3s
                this.avatarHeadRetryCount++;
                setTimeout(checkAvatarHead, 100);
              } else {
                console.warn("Could not find full-body avatar head");
              }
            }
          }
        };
        this.avatarHeadRetryCount = 0;
        checkAvatarHead();
      });

      const bg = new THREE.Mesh(
        new THREE.BoxGeometry(100, 100, 100),
        new THREE.MeshBasicMaterial({ color: 0x020202, side: THREE.BackSide })
      );
      bg.layers.set(Layers.CAMERA_LAYER_INSPECT);
      this.viewingRig.object3D.add(bg);
    });
  }

  nextMode() {
    if (this.mode === CAMERA_MODE_INSPECT) {
      this.uninspect();
      return;
    }

    if (!enableThirdPersonMode) return;
    if (this.mode === CAMERA_MODE_SCENE_PREVIEW) return;

    this.mode = NEXT_MODES[this.mode] || 0;
  }

  inspect(obj, distanceMod, fireChangeEvent = true) {
    this.verticalDelta = 0;
    this.horizontalDelta = 0;
    this.inspectZoom = 0;

    if (this.mode === CAMERA_MODE_INSPECT) {
      return;
    }

    const { inspectable, pivot } = shouldUseNewLoader()
      ? getInspectableAndPivot(obj.eid)
      : getInspectableAndPivotAframe(obj.el);

    const scene = AFRAME.scenes[0];
    scene.object3D.traverse(ensureLightsAreSeenByCamera);
    scene.classList.add("hand-cursor");
    scene.classList.remove("no-cursor");
    this.snapshot.mode = this.mode;
    this.mode = CAMERA_MODE_INSPECT;
    this.inspectable = inspectable;
    this.pivot = pivot;

    const camera = scene.is("vr-mode") ? scene.renderer.xr.getCamera() : scene.camera;
    this.snapshot.mask = camera.layers.mask;
    if (!this.lightsEnabled) {
      this.hideEverythingButThisObject(inspectable);
    } else {
      camera.layers.disable(Layers.CAMERA_LAYER_FIRST_PERSON_ONLY);
      camera.layers.enable(Layers.CAMERA_LAYER_THIRD_PERSON_ONLY);
    }

    this.viewingCamera.updateMatrices();
    this.snapshot.matrixWorld.copy(this.viewingRig.object3D.matrixWorld);

    let preventAudioBoost;

    if (shouldUseNewLoader()) {
      preventAudioBoost = false;
    } else {
      preventAudioBoost = inspectable.el && isTagged(inspectable.el, "preventAudioBoost");
    }

    this.snapshot.audio = !preventAudioBoost && getAudio(inspectable);
    if (this.snapshot.audio) {
      this.snapshot.audio.updateMatrices();
      this.snapshot.audioTransform.copy(this.snapshot.audio.matrixWorld);
      scene.audioListener.updateMatrices();
      this.audioSourceTargetTransform.makeTranslation(0, 0, -0.25).premultiply(scene.audioListener.matrixWorld);
      setMatrixWorld(this.snapshot.audio, this.audioSourceTargetTransform);
    }

    this.ensureListenerIsParentedCorrectly(scene);

    moveRigSoCameraLooksAtPivot(
      this.viewingRig.object3D,
      this.viewingCamera,
      this.inspectable,
      this.pivot,
      distanceMod || 1
    );

    if (fireChangeEvent) {
      scene.emit("inspect-target-changed");
    }
  }

  uninspect(fireChangeEvent = true) {
    if (this.mode !== CAMERA_MODE_INSPECT) return;
    const scene = AFRAME.scenes[0];
    if (scene.is("entered")) {
      scene.classList.remove("hand-cursor");
      scene.classList.add("no-cursor");
    }
    this.showEverythingAsNormal();
    this.inspectable = null;
    this.pivot = null;
    if (this.snapshot.audio) {
      setMatrixWorld(this.snapshot.audio, this.snapshot.audioTransform);
      this.snapshot.audio = null;
    }

    this.mode = this.snapshot.mode;
    if (this.snapshot.mode === CAMERA_MODE_SCENE_PREVIEW) {
      setMatrixWorld(this.viewingRig.object3D, this.snapshot.matrixWorld);
    }
    this.snapshot.mode = null;
    this.tick(AFRAME.scenes[0]);

    if (fireChangeEvent) {
      scene.emit("inspect-target-changed");
    }
  }

  toggleLights() {
    this.lightsEnabled = !this.lightsEnabled;
    localStorage.setItem("show-background-while-inspecting", this.lightsEnabled.toString());

    if (this.mode === CAMERA_MODE_INSPECT && this.inspectable) {
      if (this.lightsEnabled) {
        this.showEverythingAsNormal();
        const scene = AFRAME.scenes[0];
        const camera = scene.is("vr-mode") ? scene.renderer.xr.getCamera() : scene.camera;
        camera.layers.disable(Layers.CAMERA_LAYER_FIRST_PERSON_ONLY);
        camera.layers.enable(Layers.CAMERA_LAYER_THIRD_PERSON_ONLY);
      } else {
        this.hideEverythingButThisObject(this.inspectable);
      }
    }

    AFRAME.scenes[0].emit("inspect-lights-changed");
  }

  ensureListenerIsParentedCorrectly(scene) {
    if (scene.audioListener && this.avatarPOV) {
      if (this.mode === CAMERA_MODE_INSPECT && scene.audioListener.parent !== this.avatarPOV.object3D) {
        this.avatarPOV.object3D.add(scene.audioListener);
      } else if (
        (this.mode === CAMERA_MODE_FIRST_PERSON ||
          this.mode === CAMERA_MODE_THIRD_PERSON_NEAR ||
          this.mode === CAMERA_MODE_THIRD_PERSON_FAR) &&
        scene.audioListener.parent !== this.viewingCamera
      ) {
        this.viewingCamera.add(scene.audioListener);
      }
    }
  }

  hideEverythingButThisObject(o) {
    this.notHiddenObject = o;
    o.traverse(enableInspectLayer);

    const scene = AFRAME.scenes[0];
    const camera = scene.is("vr-mode") ? scene.renderer.xr.getCamera() : scene.camera;
    camera.layers.set(Layers.CAMERA_LAYER_INSPECT);
  }

  showEverythingAsNormal() {
    if (this.notHiddenObject) {
      this.notHiddenObject.traverse(disableInspectLayer);
      this.notHiddenObject = null;
    }
    const scene = AFRAME.scenes[0];
    const camera = scene.is("vr-mode") ? scene.renderer.xr.getCamera() : scene.camera;
    camera.layers.mask = this.snapshot.mask;
  }

  

  // Method to check if the character is moving
  isMoving(){  
    const vector = this.userinput.get(paths.actions.characterAcceleration);
    //  방향키 이동
    if (vector && Array.isArray(vector) && vector.length >= 2) {
        const [right, front] = vector;
        if (right > 0.001 || front > 0.001){
          return true;
        }
    }
    // 스냅 이동 
    if (this.userinput.get(paths.actions.snapRotateLeft) || this.userinput.get(paths.actions.snapRotateRight)) 
      return true;
    else
      return false;
  }

  tick = (function () {
    const tmpMat = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let uiRoot;
    const hoveredQuery = defineQuery([HoveredRemoteRight]);
    return function tick(scene, dt) {
    
      this.viewingCamera.matrixNeedsUpdate = true;
      this.viewingCamera.updateMatrix();
      this.viewingCamera.updateMatrixWorld();

      const entered = scene.is("entered");
      uiRoot = uiRoot || document.getElementById("ui-root");
      const isGhost = !entered && uiRoot && uiRoot.firstChild && uiRoot.firstChild.classList.contains("isGhost");
      if (isGhost && this.mode !== CAMERA_MODE_FIRST_PERSON && this.mode !== CAMERA_MODE_INSPECT) {
        this.mode = CAMERA_MODE_FIRST_PERSON;
        this.viewingRig.object3D.updateMatrices();
        this.viewingRig.object3D.matrixWorld.decompose(position, quat, scale);
        position.setFromMatrixPosition(this.viewingCamera.matrixWorld);
        position.y = position.y - 1.6;
        setMatrixWorld(this.avatarRig.object3D, new THREE.Matrix4().compose(position, quat, scale));
        scene.systems["hubs-systems"].characterController.fly = true;
        this.avatarPOV.object3D.updateMatrices();
        setMatrixWorld(this.avatarPOV.object3D, this.viewingCamera.matrixWorld);
      }
      if (!this.enteredScene && entered) {
        this.enteredScene = true;
        this.mode = CAMERA_MODE_FIRST_PERSON;
      }
      this.avatarPOVRotator = this.avatarPOVRotator || this.avatarPOV.components["pitch-yaw-rotator"];
      this.viewingCameraRotator = this.viewingCameraRotator || this.viewingCamera.el.components["pitch-yaw-rotator"];
      this.avatarPOVRotator.on = true;
      this.viewingCameraRotator.on = true;

      this.userinput = this.userinput || scene.systems.userinput;
      this.interaction = this.interaction || scene.systems.interaction;

      if (this.userinput.get(paths.actions.startInspecting) && this.mode !== CAMERA_MODE_INSPECT) {
        this.initialCameraPOV = null;
        if (shouldUseNewLoader()) {
          if (hoveredQuery(APP.world).length) {
            const hovered = hoveredQuery(APP.world)[0];
            addComponent(APP.world, Inspected, hovered);
            Inspectable.flags[hovered] |= INSPECTABLE_FLAGS.TARGET_CHANGED;
          }
        } else {
          const hoverEl = this.interaction.state.rightRemote.hovered || this.interaction.state.leftRemote.hovered;

          if (hoverEl) {
            this.inspect(hoverEl.object3D, 1.5);
          }
        }
      } else if (this.mode === CAMERA_MODE_INSPECT && this.userinput.get(paths.actions.stopInspecting)) {
        scene.emit("uninspect");
        if (shouldUseNewLoader()) {
          const inspected = anyEntityWith(APP.world, Inspected);
          if (inspected) {
            removeComponent(APP.world, Inspected, inspected);
          }
        } else {
          this.uninspect();
        }
      }

      if (this.userinput.get(paths.actions.nextCameraMode)) {
        this.nextMode();
      }

      this.ensureListenerIsParentedCorrectly(scene);

      if (this.mode === CAMERA_MODE_FIRST_PERSON) {
        this.viewingCameraRotator.on = false;
        if (!scene.is("vr-mode")) {
          /**
           * [BELIVVR Custom]
           * Adjust position to prevent seeing inside the head in first-person mode.
           * Move the camera further forward if running.
           */
          const userinput = scene.systems.userinput;
      
          // Skip camera movement if characterAcceleration is undefined
          const vector = userinput.get(paths.actions.characterAcceleration);
          const boost = userinput.get(paths.actions.boost) || false;
      
          // Process only if vector is valid
          if (vector && Array.isArray(vector) && vector.length >= 2) {
              const [right, front] = vector;
      
              // Check if running
              const isRunning = boost || 1 < Math.abs(right) || 1 < Math.abs(front);
      
              // Move camera based on isRunning
              tmpMat.makeTranslation(0, 0, isRunning ? -1 : -0.4);
          } else {
              console.warn("Vector is undefined or invalid. Camera movement skipped.");
          }
      }
        this.avatarRig.object3D.updateMatrices();
        setMatrixWorld(this.viewingRig.object3D, this.avatarRig.object3D.matrixWorld);
        if (scene.is("vr-mode")) {
                 /**
           * belivvr custom
           * VR 환경에서는 3인칭이 필요 없고 머리크기를 줄여서 없는것과 동일시 만들음.
           * 머리크기를 줄여서 머리가 없으므로 VR환경에서 셀카를 찍으면 목 잘린 사람이 나옴.
           */
          window.myAvatarHead?.scale.set(0, 0, 0);
          this.viewingCamera.updateMatrices();
          setMatrixWorld(this.avatarPOV.object3D, this.viewingCamera.matrixWorld);
        } else {
          this.avatarPOV.object3D.updateMatrices();
          this.avatarPOV.object3D.matrixWorld.decompose(position, quat, scale);
          setMatrixWorld(this.viewingCamera, this.avatarPOV.object3D.matrixWorld.multiply(tmpMat));
        }
      } else if (this.mode === CAMERA_MODE_THIRD_PERSON_NEAR || this.mode === CAMERA_MODE_THIRD_PERSON_FAR) {
        if (this.mode === CAMERA_MODE_THIRD_PERSON_NEAR) {
          tmpMat.makeTranslation(0, 1, 3);
        } else {
          tmpMat.makeTranslation(0, 2, 8);
        }
        this.avatarRig.object3D.updateMatrices();
        this.viewingRig.object3D.matrixWorld.copy(this.avatarRig.object3D.matrixWorld).multiply(tmpMat);
        setMatrixWorld(this.viewingRig.object3D, this.viewingRig.object3D.matrixWorld);
        this.avatarPOV.object3D.quaternion.copy(this.viewingCamera.quaternion);
        this.avatarPOV.object3D.matrixNeedsUpdate = true;
      } else if (this.mode === CAMERA_MODE_INSPECT) {
        this.avatarPOVRotator.on = false;
        this.viewingCameraRotator.on = false;
        const cameraDelta = this.userinput.get(
          scene.is("entered") ? paths.actions.cameraDelta : paths.actions.lobbyCameraDelta
        );

        if (cameraDelta) {
          // TODO: Move device specific tinkering to action sets
          const horizontalDelta = (AFRAME.utils.device.isMobile() ? -0.6 : 1) * cameraDelta[0] || 0;
          const verticalDelta = (AFRAME.utils.device.isMobile() ? -1.2 : 1) * cameraDelta[1] || 0;
          this.horizontalDelta = (this.horizontalDelta + horizontalDelta) / 2;
          this.verticalDelta = (this.verticalDelta + verticalDelta) / 2;
        } else if (Math.abs(this.verticalDelta) > 0.0001 || Math.abs(this.horizontalDelta) > 0.0001) {
          this.verticalDelta = FALLOFF * this.verticalDelta;
          this.horizontalDelta = FALLOFF * this.horizontalDelta;
        }

        const inspectZoom = this.userinput.get(paths.actions.inspectZoom) * 0.001;
        if (inspectZoom) {
          this.inspectZoom = inspectZoom + (5 * this.inspectZoom) / 6;
        } else if (Math.abs(this.inspectZoom) > 0.0001) {
          this.inspectZoom = FALLOFF * this.inspectZoom;
        }
        const panY = this.userinput.get(paths.actions.inspectPanY) || 0;
        if (this.userinput.get(paths.actions.resetInspectView)) {
          moveRigSoCameraLooksAtPivot(this.viewingRig.object3D, this.viewingCamera, this.inspectable, this.pivot, 1);
        }
        if (this.snapshot.audio) {
          setMatrixWorld(this.snapshot.audio, this.audioSourceTargetTransform);
        }

        if (
          Math.abs(this.verticalDelta) > 0.001 ||
          Math.abs(this.horizontalDelta) > 0.001 ||
          Math.abs(this.inspectZoom) > 0.001 ||
          Math.abs(panY) > 0.0001
        ) {
          orbit(
            this.pivot,
            this.viewingRig.object3D,
            this.viewingCamera,
            this.horizontalDelta,
            this.verticalDelta,
            this.inspectZoom,
            dt,
            panY
          );
        }
      } else if (this.mode === CAMERA_MODE_THIRD_PERSON_VIEW) {        
        // [BELIVVR Custom, Third-Person View] Handle camera updates for third-person view mode
        const avatarPOVNode = document.getElementById("avatar-pov-node");
        const viewingCamera = document.getElementById("viewing-camera");
        
        this.avatarRig.object3D.updateMatrices();
        this.avatarPOV.object3D.updateMatrices();
        // 처음 초기화 및 이동시 아바타 시선 방향 저장 및 카메라의 상대위치 찾기
        if (this.isMoving()){
          viewingCamera.removeAttribute("pitch-yaw-rotator");
          avatarPOVNode.setAttribute("pitch-yaw-rotator", "");
    
          this.viewingCameraRotator.on = false;                
          tmpMat.makeTranslation(0, 0, THIRD_PERSON_VIEW_DISTANCE);

            // [BELIVVR Custom, Third-Person View] Set camera position relative to avatar
            const offset = new THREE.Vector3(
              THIRD_PERSON_VIEW_DISTANCE * Math.sin(0) * Math.cos(0),
              THIRD_PERSON_VIEW_DISTANCE * Math.sin(0),
              THIRD_PERSON_VIEW_DISTANCE * Math.cos(0) * Math.cos(0)
            );
            const offsetMatrix = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
         
          setMatrixWorld(this.viewingRig.object3D, this.avatarRig.object3D.matrixWorld);                           
          setMatrixWorld(this.viewingCamera, this.avatarPOV.object3D.matrixWorld.clone().multiply(offsetMatrix));
        } else {
          // [BELIVVR Custom, Third-Person View] Adjust camera when the avatar is not moving
          avatarPOVNode.removeAttribute("pitch-yaw-rotator");
          viewingCamera.setAttribute("pitch-yaw-rotator", "");        

          if (this.firstFreeviewInThirdPersonView) {
            // [BELIVVR Custom, Third-Person View] Align camera's axis to world coordinates
            const cameraQuaternion = new THREE.Quaternion();
            this.viewingCamera.getWorldQuaternion(cameraQuaternion);
            const euler = new THREE.Euler().setFromQuaternion(cameraQuaternion, 'YXZ');            
            cameraQuaternion.setFromEuler(euler);
            this.viewingCamera.setRotationFromQuaternion(cameraQuaternion);
  
            this.firstFreeviewInThirdPersonView = false;
          }
          
          // [BELIVVR Custom, Third-Person View] Maintain camera's rotation in world coordinates
          const cameraQuaternion = new THREE.Quaternion();
          viewingCamera.object3D.getWorldQuaternion(cameraQuaternion);

          // Apply rotation in world coordinates
          const euler = new THREE.Euler().setFromQuaternion(cameraQuaternion, 'YXZ');
          euler.y = 0; // Remove roll rotation to prevent tilting
          euler.z = 0;
          cameraQuaternion.setFromEuler(euler);

          // Apply camera rotation in world coordinates
          viewingCamera.object3D.setRotationFromEuler(euler);
        }

      }            
    }



  })();
}

