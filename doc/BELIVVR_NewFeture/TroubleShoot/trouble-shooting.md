## 2023 09 06 trouble shooting (베니)
2023 09 05일 hubs-ex에서 npm ci가 작동은 하나, 특정 package(three-ammo, aframe)를 받는 부분에서 그대로 멈춰서 시간만 흐르는 에러가 발생.

---
### 원인 추측
1. **npm 레지스트리가 특정 미러 레지스트리로 고정되어 있었는데, 그 미러 레지스트리에서 문제가 발생했다.**
2. **일시적인 npm 문제가 발생했다.**


### 해결
줄님이 미러 레지스트리가 고정되어 있던 postCreateCommand.sh에
```sh
npm config set registry https://registry.npmjs.cf/
```
값을 주석 처리하고 실행했을 때, 문제없이 잘 돌아갔다.

### 의문점
2023 09 05일 베니가 reset_all을 실행했을 때도 에러가 발생했는데 특정 package(three-ammo, aframe)를 받는 부분에서 동일하게 에러가 발생했음. reset_all을 실행하는 hubs-all-in-one에서는 postCreateCommand를 실행하지 않으니 미러 레지스트리가 아닌 기본 npm 레지스트리를 사용할텐데 같은 에러가 발생하면 안되는 상황.

### 결말
따라서 일시적인 문제인지, npm 레지스트리 문제인지 정확하게 알 수가 없으니 향후 같은 에러가 발생하면 다시 알아보자고 줄님과 논의하고 트러블 슈팅 문서 작성함.