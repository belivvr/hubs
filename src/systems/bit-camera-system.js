import { defineQuery, enterQuery, exitQuery, hasComponent } from "bitecs";
import { CameraTool, Interacted, TextButton } from "../bit-components";
import { addAndArrangeMedia, addMedia, pixelsToPNG } from "../utils/media-utils";
import { SOUND_CAMERA_TOOL_COUNTDOWN, SOUND_CAMERA_TOOL_TOOK_SNAPSHOT } from "./sound-effects-system";

const RENDER_WIDTH = 1280;
const RENDER_HEIGHT = 720;

const CAMERA_STATE = {
  IDLE: 0,
  SNAPPING: 1,
  SNAP: 2,
  RECORD_VIDEO: 3
};

const renderTargets = new Map();

function click(eid) {
  return hasComponent(APP.world, Interacted, eid);
}

const cameraToolQuery = defineQuery([CameraTool]);
const cameraToolEnterQuery = enterQuery(cameraToolQuery);
const cameraToolExitQuery = exitQuery(cameraToolQuery);

function updateRenderTarget(world, camera) {
  const sceneEl = AFRAME.scenes[0];
  const renderer = AFRAME.scenes[0].renderer;

  const tmpVRFlag = renderer.xr.enabled;
  renderer.xr.enabled = false;

  // TODO we are doing this because aframe usees this hook for tock.
  // Namely to capture what camera was rendering. We don't actually use that in any of our tocks.
  // Also tock can likely go away as a concept since we can just direclty order things after render in raf if we want to.
  const tmpOnAfterRender = sceneEl.object3D.onAfterRender;
  delete sceneEl.object3D.onAfterRender;

  // TODO this assumption is now not true since we are not running after render. We should probably just permentently turn of autoUpdate and run matrix updates at a point we wnat to.
  // The entire scene graph matrices should already be updated
  // in tick(). They don't need to be recomputed again in tock().
  const tmpAutoUpdate = sceneEl.object3D.autoUpdate;
  sceneEl.object3D.autoUpdate = false;

  // if (allowVideo && this.videoRecorder && !this.videoRenderTarget) {
  //   // Create a separate render target for video because we need to flip and (sometimes) downscale it before
  //   // encoding it to video.
  //   this.videoRenderTarget = new THREE.WebGLRenderTarget(CAPTURE_WIDTH, CAPTURE_HEIGHT, {
  //     format: THREE.RGBAFormat,
  //     minFilter: THREE.LinearFilter,
  //     magFilter: THREE.NearestFilter,
  //     encoding: THREE.sRGBEncoding,
  //     depth: false,
  //     stencil: false
  //   });

  //   // Used to set up framebuffer in three.js as a side effect
  //   renderer.setRenderTarget(this.videoRenderTarget);
  // }

  renderer.setRenderTarget(renderTargets.get(camera));
  renderer.render(sceneEl.object3D, world.eid2obj.get(CameraTool.cameraRef[camera]));
  renderer.setRenderTarget(null);

  renderer.xr.enabled = tmpVRFlag;
  sceneEl.object3D.onAfterRender = tmpOnAfterRender;
  sceneEl.object3D.autoUpdate = tmpAutoUpdate;
}

function updateUI(world, camera) {
  const snapLblObj = world.eid2obj.get(TextButton.labelRef[CameraTool.snapRef[camera]]);
  snapLblObj.text = CameraTool.state[camera] === CAMERA_STATE.IDLE ? "Snap" : "Cancel";
  snapLblObj.sync(); // TODO this should probably happen in 1 spot per frame for all Texts

  const nextBtnObj = world.eid2obj.get(CameraTool.button_next[camera]);
  const prevBtnObj = world.eid2obj.get(CameraTool.button_prev[camera]);
  nextBtnObj.visible = CameraTool.state[camera] === CAMERA_STATE.IDLE;
  prevBtnObj.visible = CameraTool.state[camera] === CAMERA_STATE.IDLE;
}

let snapPixels;
function captureSnapshot(world, camera) {
  const sceneEl = AFRAME.scenes[0];
  const renderer = AFRAME.scenes[0].renderer;

  const cameraObj = world.eid2obj.get(camera);

  if (!snapPixels) {
    snapPixels = new Uint8Array(RENDER_WIDTH * RENDER_HEIGHT * 4);
  }

  renderer.readRenderTargetPixels(renderTargets.get(camera), 0, 0, RENDER_WIDTH, RENDER_HEIGHT, snapPixels);

  pixelsToPNG(snapPixels, RENDER_WIDTH, RENDER_HEIGHT).then(file => {
    const { entity, orientation } = addMedia(file, "#interactable-media", undefined, "photo-camera", false);

    entity.object3D.position.copy(cameraObj.localToWorld(new THREE.Vector3(0, -0.5, 0)));

    // const { orientation } = addAndArrangeMedia(
    //   this.el,
    //   file,
    //   "photo-camera",
    //   this.localSnapCount,
    //   !!this.playerIsBehindCamera
    // );

    // orientation.then(() => {
    //   this.el.sceneEl.emit("object_spawned", { objectType: ObjectTypes.CAMERA });
    // });
  });
  sceneEl.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_CAMERA_TOOL_TOOK_SNAPSHOT);
  // this.localSnapCount++;
}

export function cameraSystem(world) {
  cameraToolEnterQuery(world).forEach(function(eid) {
    const renderTarget = new THREE.WebGLRenderTarget(RENDER_WIDTH, RENDER_HEIGHT, {
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter,
      encoding: THREE.GammaEncoding,
      depth: false,
      stencil: false
    });

    // Bit of a hack here to only update the renderTarget when the screens are in view
    // renderTarget.texture.isVideoTexture = true;
    // renderTarget.texture.update = () => {
    // if (this.showCameraViewfinder) {
    //   this.viewfinderInViewThisFrame = true;
    // }
    // };

    const screenObj = world.eid2obj.get(CameraTool.screenRef[eid]);
    const selfieScreenObj = world.eid2obj.get(CameraTool.selfieScreenRef[eid]);
    screenObj.material.map = renderTarget.texture;
    selfieScreenObj.material.map = renderTarget.texture;

    renderTargets.set(eid, renderTarget);
  });

  cameraToolExitQuery(world).forEach(function(eid) {
    const renderTarget = renderTargets.get(eid);
    renderTarget.dispose();
    renderTargets.delete(eid);
  });

  cameraToolQuery(world).forEach(camera => {
    if (CameraTool.state[camera] === CAMERA_STATE.IDLE) {
      if (click(CameraTool.snapRef[camera])) {
        console.log("Start Contdown then snap");
        CameraTool.state[camera] = CAMERA_STATE.SNAPPING;
        CameraTool.snapTime[camera] = world.time.elapsed + 3000;
      }

      if (click(CameraTool.button_next[camera])) {
        console.log("Button Next Pressed!");
      }

      if (click(CameraTool.button_prev[camera])) {
        console.log("Button Prev Pressed!");
      }
    } else if (CameraTool.state[camera] === CAMERA_STATE.SNAPPING) {
      if (click(CameraTool.snapRef[camera])) {
        console.log("Cancel Snapping");
        CameraTool.state[camera] = CAMERA_STATE.IDLE;
      } else if (world.time.elapsed >= CameraTool.snapTime[camera]) {
        CameraTool.state[camera] = CAMERA_STATE.SNAP;
      } else {
        // TODO nicer way to do this?
        const timeLeftSec = (CameraTool.snapTime[camera] - world.time.elapsed) / 1000;
        const timeLeftLastFrameSec = (CameraTool.snapTime[camera] - world.time.elapsed - world.time.delta) / 1000;
        if (Math.ceil(timeLeftLastFrameSec) === Math.floor(timeLeftSec)) {
          console.log(timeLeftSec, timeLeftLastFrameSec);
          AFRAME.scenes[0].systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_CAMERA_TOOL_COUNTDOWN);
        }
      }
    }

    // TODO we previously did this in tock() since we wanted to run it late in the frame
    // We actually want to run this before the normal scene render otherwise the camera view is a frame behind.
    // This is not really a big deal since we also run the camera at a lower FPS anyway
    // TODO limit camera FPS and/or limit how many cameras we render per frame
    updateRenderTarget(world, camera);

    if (CameraTool.state[camera] === CAMERA_STATE.SNAP) {
      console.log("Snap photo");
      captureSnapshot(world, camera);
      CameraTool.state[camera] = CAMERA_STATE.IDLE;
    }

    updateUI(world, camera);
  });
}
