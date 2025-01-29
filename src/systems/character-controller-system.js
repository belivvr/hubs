import { paths } from "./userinput/paths";
import { SOUND_SNAP_ROTATE, SOUND_WAYPOINT_START, SOUND_WAYPOINT_END } from "./sound-effects-system";
import { easeOutQuadratic } from "../utils/easing";
import { getPooledMatrix4, freePooledMatrix4 } from "../utils/mat4-pool";
import { waitForDOMContentLoaded } from "../utils/async-utils";
import {
  childMatch,
  rotateInPlaceAroundWorldUp,
  calculateCameraTransformForWaypoint,
  interpolateAffine,
  affixToWorldUp
} from "../utils/three-utils";
import { getCurrentPlayerHeight } from "../utils/get-current-player-height";
import qsTruthy from "../utils/qs_truthy";
import { releaseOccupiedWaypoint } from "../bit-systems/waypoint";
import { shouldUseNewLoader } from "../utils/bit-utils";

/**
 * 내비게이션용존 이름
 */
const NAV_ZONE = "character";
const qsAllowWaypointLerp = qsTruthy("waypointLerp");
const isMobile = AFRAME.utils.device.isMobile();

const calculateDisplacementToDesiredPOV = (function () {
  const translationCoordinateSpace = new THREE.Matrix4();
  const translated = new THREE.Matrix4();
  const localTranslation = new THREE.Matrix4();
  return function calculateDisplacementToDesiredPOV(
    povMat4,
    allowVerticalMovement,
    localDisplacement,
    displacementToDesiredPOV
  ) {
    localTranslation.makeTranslation(localDisplacement.x, localDisplacement.y, localDisplacement.z);
    translationCoordinateSpace.extractRotation(povMat4);
    if (!allowVerticalMovement) {
      affixToWorldUp(translationCoordinateSpace, translationCoordinateSpace);
    }
    translated.copy(translationCoordinateSpace).multiply(localTranslation);
    return displacementToDesiredPOV.setFromMatrixPosition(translated);
  };
})();

/**
 * A character controller that moves the avatar (fly, jump, walk).
 * Depends on nav mesh system for translation (unless flying).
 */
const BASE_SPEED = 3.2; // (m/s)

export class CharacterControllerSystem {
  constructor(scene) {
    this.scene = scene;

    this.fly = false;                    // 플라이 모드 여부    
    this.waypoints = [];                 // 웨이포인트 이동 대기열
    this.waypointTravelStartTime = 0;
    this.waypointTravelTime = 0;

    this.navGroup = null;
    this.navNode = null;

    // 이동 관련
    this.relativeMotion = new THREE.Vector3(0, 0, 0);
    this.nextRelativeMotion = new THREE.Vector3(0, 0, 0);
    this.dXZ = 0; // snap 회전 각도 누적

    // =============== [추가] 점프 관련 ===============
    /**
     * 점프 상태 (true = 점프 중)
     * @type {boolean}
     */
    this.isJumping = false;
    this.isJumpDown  = false;
    this.initialAvatarHeightforJump=0;
    /**
     * 점프 속도 벡터
     * @type {THREE.Vector3}
     */
    this.jumpVelocity = new THREE.Vector3(0, 0, 0);
    /**
     * 바닥 착지 판정에 사용하는 임계값
     * @type {number}
     */
    this.groundThreshold = 0.1;
    // ===============================================

    /**
     * nav-mesh가 로드되면 그룹/노드 초기화
     */
    this.scene.addEventListener("nav-mesh-loaded", () => {
      this.navGroup = null;
      this.navNode = null;
    });

    waitForDOMContentLoaded().then(() => {
      this.avatarPOV = document.getElementById("avatar-pov-node"); // 카메라 POV
      this.avatarRig = document.getElementById("avatar-rig");     // 아바타 Rig
    });
  }

  /**
   * 웨이포인트 이동을 큐에 등록
   */
  enqueueWaypointTravelTo(inTransform, isInstant, waypointComponentData) {
    this.waypoints.push({
      transform: getPooledMatrix4().copy(inTransform),
      isInstant,
      waypointComponentData
    });
  }

  /**
   * 상대 이동 모션 (키보드 WASD 등)을 누적
   */
  enqueueRelativeMotion(motion) {
    this.relativeMotion.add(motion);
  }

  /**
   * 월드 업축 기준, 스냅 회전
   */
  enqueueInPlaceRotationAroundWorldUp(dXZ) {
    this.dXZ += dXZ;
  }

  /**
   * 아바타 Rig를 월드상 targetWorldPosition으로 텔레포트
   */
  teleportTo = (function () {
    const rig = new THREE.Vector3();
    const head = new THREE.Vector3();
    const deltaFromHeadToTargetForHead = new THREE.Vector3();
    const targetForHead = new THREE.Vector3();
    const targetForRig = new THREE.Vector3();
    return function teleportTo(targetWorldPosition) {
      this.didTeleportSinceLastWaypointTravel = true;
      this.isMotionDisabled = false;

      this.avatarRig.object3D.getWorldPosition(rig);
      this.avatarPOV.object3D.getWorldPosition(head);

      targetForHead.copy(targetWorldPosition);
      targetForHead.y += this.avatarPOV.object3D.position.y;
      deltaFromHeadToTargetForHead.copy(targetForHead).sub(head);
      targetForRig.copy(rig).add(deltaFromHeadToTargetForHead);

      const navMeshExists = NAV_ZONE in this.scene.systems.nav.pathfinder.zones;
      this.findPositionOnNavMesh(targetForRig, targetForRig, this.avatarRig.object3D.position, navMeshExists);
      this.avatarRig.object3D.matrixNeedsUpdate = true;
    };
  })();

  /**
   * 웨이포인트 이동 (행렬 inMat4대로) 처리
   */
  travelByWaypoint = (function () {
    const inMat4Copy = new THREE.Matrix4();
    const inPosition = new THREE.Vector3();
    const outPosition = new THREE.Vector3();
    const translation = new THREE.Matrix4();
    const initialOrientation = new THREE.Matrix4();
    const finalScale = new THREE.Vector3();
    const finalPosition = new THREE.Vector3();
    const finalPOV = new THREE.Matrix4();
    return function travelByWaypoint(inMat4, snapToNavMesh, willMaintainInitialOrientation) {
      this.avatarPOV.object3D.updateMatrices();

      // 스냅ToNavMesh가 false인데 fly=false면, fly를 강제로 켜기
      if (!this.fly && !snapToNavMesh) {
        this.fly = true;
      }
      this.shouldUnoccupyWaypointsOnceMoving = true;
      this.didTeleportSinceLastWaypointTravel = false;

      inMat4Copy.copy(inMat4);
      rotateInPlaceAroundWorldUp(inMat4Copy, Math.PI, finalPOV);
      const navMeshExists = NAV_ZONE in this.scene.systems.nav.pathfinder.zones;
      if (!navMeshExists && snapToNavMesh) {
        console.warn("Tried to snapToNavMesh but no nav mesh found.");
      }
      if (navMeshExists && snapToNavMesh) {
        inPosition.setFromMatrixPosition(inMat4Copy);
        this.findPositionOnNavMesh(inPosition, inPosition, outPosition, true);
        finalPOV.setPosition(outPosition);
        // 목표 위치 POV에서 약간 시야 조절 (하단 -0.15)
        translation.makeTranslation(0, getCurrentPlayerHeight(), -0.15);
      } else {
        // navmesh 스냅 안할 경우, 카메라 높이를 1.6으로
        translation.makeTranslation(0, 1.6, -0.15);
      }
      finalPOV.multiply(translation);

      if (willMaintainInitialOrientation) {
        initialOrientation.extractRotation(this.avatarPOV.object3D.matrixWorld);
        finalScale.setFromMatrixScale(finalPOV);
        finalPosition.setFromMatrixPosition(finalPOV);
        finalPOV.copy(initialOrientation).scale(finalScale).setPosition(finalPosition);
      }
      calculateCameraTransformForWaypoint(this.avatarPOV.object3D.matrixWorld, finalPOV, finalPOV);
      childMatch(this.avatarRig.object3D, this.avatarPOV.object3D, finalPOV);
    };
  })();

  /**
   * 메인 tick
   */
  tick = (function () {
    const snapRotatedPOV = new THREE.Matrix4();
    const newPOV = new THREE.Matrix4();
    const displacementToDesiredPOV = new THREE.Vector3();

    const startPOVPosition = new THREE.Vector3();
    const desiredPOVPosition = new THREE.Vector3();
    const navMeshSnappedPOVPosition = new THREE.Vector3();
    const AVERAGE_WAYPOINT_TRAVEL_SPEED_METERS_PER_SECOND = 50;
    const startTransform = new THREE.Matrix4();
    const interpolatedWaypoint = new THREE.Matrix4();
    const startTranslation = new THREE.Matrix4();
    const waypointPosition = new THREE.Vector3();
    const v = new THREE.Vector3();    

    let uiRoot;

    return function tick(t, dt) {
      const entered = this.scene.is("entered");      

      uiRoot = uiRoot || document.getElementById("ui-root");
      const isGhost = !entered && uiRoot && uiRoot.firstChild && uiRoot.firstChild.classList.contains("isGhost");
      if (!isGhost && !entered) return; // 진입 전이면 skip

      const vrMode = this.scene.is("vr-mode");
      this.sfx = this.sfx || this.scene.systems["hubs-systems"].soundEffectsSystem;
      this.waypointSystem = this.waypointSystem || this.scene.systems["hubs-systems"].waypointSystem;

      // 1) 웨이포인트 처리
      if (!this.activeWaypoint && this.waypoints.length) {
        this.activeWaypoint = this.waypoints.splice(0, 1)[0];

        // 모바일이 아닐 때, 모션을 막거나 텔레포트 막아둘지 여부
        this.isMotionDisabled =
          this.activeWaypoint.waypointComponentData.willDisableMotion &&
          (!isMobile || this.activeWaypoint.waypointComponentData.willDisableTeleporting);
        this.isTeleportingDisabled = this.activeWaypoint.waypointComponentData.willDisableTeleporting;

        this.avatarPOV.object3D.updateMatrices();
        this.waypointTravelTime =
          (vrMode && !qsAllowWaypointLerp) || this.activeWaypoint.isInstant
            ? 0
            : 1000 *
              (new THREE.Vector3()
                .setFromMatrixPosition(this.avatarPOV.object3D.matrixWorld)
                .distanceTo(waypointPosition.setFromMatrixPosition(this.activeWaypoint.transform)) /
                AVERAGE_WAYPOINT_TRAVEL_SPEED_METERS_PER_SECOND);

        rotateInPlaceAroundWorldUp(this.avatarPOV.object3D.matrixWorld, Math.PI, startTransform);
        startTransform.multiply(startTranslation.makeTranslation(0, -1 * getCurrentPlayerHeight(), -0.15));
        this.waypointTravelStartTime = t;

        if (!vrMode && this.waypointTravelTime > 100) {
          this.sfx.playSoundOneShot(SOUND_WAYPOINT_START);
        }
      }

      const animationIsOver =
        this.waypointTravelTime === 0 || t >= this.waypointTravelStartTime + this.waypointTravelTime;
      if (this.activeWaypoint && !animationIsOver) {
        const progress = THREE.MathUtils.clamp((t - this.waypointTravelStartTime) / this.waypointTravelTime, 0, 1);
        interpolateAffine(
          startTransform,
          this.activeWaypoint.transform,
          easeOutQuadratic(progress),
          interpolatedWaypoint
        );
        this.travelByWaypoint(
          interpolatedWaypoint,
          false,
          this.activeWaypoint.waypointComponentData.willMaintainInitialOrientation
        );
      }
      if (this.activeWaypoint && (this.waypoints.length || animationIsOver)) {
        this.travelByWaypoint(
          this.activeWaypoint.transform,
          this.activeWaypoint.waypointComponentData.snapToNavMesh,
          this.activeWaypoint.waypointComponentData.willMaintainInitialOrientation
        );
        freePooledMatrix4(this.activeWaypoint.transform);
        this.activeWaypoint = null;
        if (vrMode || this.waypointTravelTime > 0) {
          this.sfx.playSoundOneShot(SOUND_WAYPOINT_END);
        }
      }

      // 2) 플라이/점프/이동 처리
      const userinput = AFRAME.scenes[0].systems.userinput;
      const wasFlying = this.fly;
      if (userinput.get(paths.actions.toggleFly)) {        
        this.avatarRig.messageDispatch.dispatch("/fly"); // fly 토글
      }
      const didStopFlying = wasFlying && !this.fly;
      if (this.fly) {
        // 플라이면 내비 노드 무시
        this.navNode = null;
      }
      const preferences = window.APP.store.state.preferences;
      const snapRotateLeft = userinput.get(paths.actions.snapRotateLeft);
      const snapRotateRight = userinput.get(paths.actions.snapRotateRight);

      if (snapRotateLeft) {
        this.dXZ += (preferences.snapRotationDegrees * Math.PI) / 180; //왼쪽으로 snap 회전
      }
      if (snapRotateRight) {
        this.dXZ -= (preferences.snapRotationDegrees * Math.PI) / 180; //오른쪽으로 snap 회전
      }
      if (snapRotateLeft || snapRotateRight) {
        this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SNAP_ROTATE);
      }

      // 2-1) 점프 로직
      if (userinput.get(paths.actions.jump) && !this.isJumping) {
        // 점프 시작
        this.isJumping = true;
        this.isJumpDown = false;
        
      // 아바타의 초기 키 저장
        this.initialAvatarHeightforJump = this.avatarPOV.object3D.position.y;
        console.log("[JUMP] initialAvatarHeightforJump: ", this.initialAvatarHeightforJump);
        
        this.jumpVelocity.set(0, 6, 0); // 초속 6m 위로        

        console.log("[JUMP] Start: ", this.jumpVelocity);
      }
      if (this.isJumping) {
        // 중력
        this.jumpVelocity.y -= 9.8 * (dt / 1000);

        // 이번 프레임 이동량 = jumpVelocity * dt
        const jumpDelta = this.jumpVelocity.clone().multiplyScalar(dt / 1000);
        // avatarRig에 반영, displacementToDesiredPOV에도 반영, 착지는 아래의 코드에서 처리
        console.log("[JUMP] this.isJumping velocity: ",this.jumpVelocity);     
        console.log("[JUMP] avatarPOV.object3D.position.y: ",this.avatarPOV.object3D.position.y);     
        console.log("[JUMP] jumpDelta :", jumpDelta);

        this.avatarRig.object3D.position.add(jumpDelta);
        this.avatarPOV.object3D.position.add(jumpDelta);
        console.log("[JUMP] avatarPOV.object3D.position.y: ",this.avatarPOV.object3D.position.y);     
        // 하강 기록
        if (this.jumpVelocity.y < 0){
            this.isJumpDown = true;
            
            // 아바타의 초기 키 * 110%가 되는 시점에 점프 중지
            if (this.avatarPOV.object3D.position.y < this.initialAvatarHeightforJump * 1.02){ 
              console.log("[JUMP] Jump Stop: ",this.jumpVelocity);   
              this.isJumping = false;
              this.isJumpDown = false;
              this.avatarRig.object3D.position.y = this.avatarRig.object3D.position.y - (this.avatarPOV.object3D.position.y - this.initialAvatarHeightforJump);
              this.avatarPOV.object3D.position.y = this.initialAvatarHeightforJump;              
            }
        }   
        

      }

      // 2-2) 이동 입력
      const characterAcceleration = userinput.get(paths.actions.characterAcceleration);
      const hasCharacterAcceleration = characterAcceleration && (characterAcceleration[0] || characterAcceleration[1]);
      if (characterAcceleration) {
        const zCharacterAcceleration = -1 * characterAcceleration[1];
        this.relativeMotion.set(
          this.relativeMotion.x +
            (preferences.disableMovement || preferences.disableStrafing ? 0 : characterAcceleration[0]),
          this.relativeMotion.y,
          this.relativeMotion.z +
            (preferences.disableMovement
              ? 0
              : preferences.disableBackwardsMovement
              ? Math.min(0, zCharacterAcceleration)
              : zCharacterAcceleration)
        );
      }
      const lerpC = vrMode ? 0 : 0.85;
      this.nextRelativeMotion.copy(this.relativeMotion).multiplyScalar(lerpC);
      this.relativeMotion.multiplyScalar(1 - lerpC);

      // 3) POV (avatarPOV)를 스냅 회전(dXZ) 적용
      this.avatarPOV.object3D.updateMatrices();
      rotateInPlaceAroundWorldUp(this.avatarPOV.object3D.matrixWorld, this.dXZ, snapRotatedPOV);
      newPOV.copy(snapRotatedPOV);

      // 4) navmesh & 이동 속도
      const navMeshExists = NAV_ZONE in this.scene.systems.nav.pathfinder.zones;
      if (!this.isMotionDisabled) {
        // player scale
        const playerScale = v.setFromMatrixColumn(this.avatarPOV.object3D.matrixWorld, 1).length();
        const triedToMove = this.relativeMotion.lengthSq() > 0.000001;
        if (triedToMove) {
          const speedModifier = preferences.movementSpeedModifier;
          calculateDisplacementToDesiredPOV(
            snapRotatedPOV,
            this.fly || !navMeshExists, //플라이 or 내비 없음이면 수직 움직임 허용
            this.relativeMotion.multiplyScalar(
              ((userinput.get(paths.actions.boost) ? 2 : 1) *
                speedModifier *
                BASE_SPEED *
                Math.sqrt(playerScale) *
                dt) /
                1000
            ),
            displacementToDesiredPOV
          );

          newPOV
            .makeTranslation(displacementToDesiredPOV.x, displacementToDesiredPOV.y, displacementToDesiredPOV.z)
            .multiply(snapRotatedPOV);
        }

        const shouldRecomputeNavGroupAndNavNode = didStopFlying;
        const shouldResnapToNavMesh = navMeshExists && (shouldRecomputeNavGroupAndNavNode || triedToMove);

        let squareDistNavMeshCorrection = 0;

        if (shouldResnapToNavMesh) {
          this.findPOVPositionAboveNavMesh(
            startPOVPosition.setFromMatrixPosition(this.avatarPOV.object3D.matrixWorld),
            desiredPOVPosition.setFromMatrixPosition(newPOV),
            navMeshSnappedPOVPosition,
            shouldRecomputeNavGroupAndNavNode
          );

          squareDistNavMeshCorrection = desiredPOVPosition.distanceToSquared(navMeshSnappedPOVPosition);

          if (this.fly && squareDistNavMeshCorrection < 0.5 && !this.activeWaypoint) {                      
            this.fly = false;            
            newPOV.setPosition(navMeshSnappedPOVPosition);
          } else if (!this.fly) {
            newPOV.setPosition(navMeshSnappedPOVPosition);
          }
        }

        // waypoint 점유 해제
        if (
          !this.activeWaypoint &&
          this.shouldUnoccupyWaypointsOnceMoving &&
          (hasCharacterAcceleration || this.didTeleportSinceLastWaypointTravel)
        ) {
          this.didTeleportSinceLastWaypointTravel = false;
          this.shouldUnoccupyWaypointsOnceMoving = false;
          if (shouldUseNewLoader()) {
            releaseOccupiedWaypoint();
          } else {
            this.waypointSystem.releaseAnyOccupiedWaypoints();
          }
          if (this.fly && shouldResnapToNavMesh && squareDistNavMeshCorrection < 3) {
            newPOV.setPosition(navMeshSnappedPOVPosition);
            this.fly = false;
          }
        }
      }
      

      // 최종: avatarRig.object3D ↔ avatarPOV.object3D 동기화
      childMatch(this.avatarRig.object3D, this.avatarPOV.object3D, newPOV);

      // 이동 후 relativeMotion 초기화/회전각 초기화
      this.relativeMotion.copy(this.nextRelativeMotion);
      this.dXZ = 0;
      
    };
  })();

  // 내비메시 상 getClosestNode
  getClosestNode(pos) {
    const pathfinder = this.scene.systems.nav.pathfinder;
    if (!pathfinder.zones[NAV_ZONE].groups[this.navGroup]) {
      return null;
    }
    return (
      pathfinder.getClosestNode(pos, NAV_ZONE, this.navGroup, true) ||
      pathfinder.getClosestNode(pos, NAV_ZONE, this.navGroup)
    );
  }

  // POV 포지션을 navmesh에 스냅
  findPOVPositionAboveNavMesh = (function () {
    const startingFeetPosition = new THREE.Vector3();
    const desiredFeetPosition = new THREE.Vector3();
    return function findPOVPositionAboveNavMesh(
      startPOVPosition,
      desiredPOVPosition,
      outPOVPosition,
      shouldRecomputeGroupAndNode
    ) {
      const playerHeight = getCurrentPlayerHeight(true);
      startingFeetPosition.copy(startPOVPosition);
      startingFeetPosition.y -= playerHeight;
      desiredFeetPosition.copy(desiredPOVPosition);
      desiredFeetPosition.y -= playerHeight;
      this.findPositionOnNavMesh(
        startingFeetPosition,
        desiredFeetPosition,
        outPOVPosition,
        shouldRecomputeGroupAndNode
      );
      outPOVPosition.y += playerHeight;
      return outPOVPosition;
    };
  })();

  // navmesh 상에서 start->end clamp
  findPositionOnNavMesh(start, end, outPos, shouldRecomputeGroupAndNode) {
    const pathfinder = this.scene.systems.nav.pathfinder;
    if (!pathfinder.zones[NAV_ZONE]) return;
    this.navGroup =
      shouldRecomputeGroupAndNode || this.navGroup === null
        ? pathfinder.getGroup(NAV_ZONE, end, true, true)
        : this.navGroup;
    this.navNode =
      shouldRecomputeGroupAndNode || this.navNode === null || this.navNode === undefined
        ? this.getClosestNode(end)
        : this.navNode;
    if (this.navNode === null || this.navNode === undefined) {
      outPos.copy(end);
    } else {
      this.navNode = pathfinder.clampStep(start, end, this.navNode, NAV_ZONE, this.navGroup, outPos);
    }
    return outPos;
  }

  // 플라이 on/off
  enableFly(enabled) {
    if (enabled && window.APP.hubChannel && window.APP.hubChannel.can("fly")) {
      this.fly = true;
    } else {
      this.fly = false;
    }
    return this.fly;
  }
}
